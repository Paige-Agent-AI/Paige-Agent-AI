# Customer Portal — Pause, restore or end a client's access (E09 Slice 7)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: actor-goal flows mapped before edit from the plan and its binding review — owner pauses, restores or ends one joined client's access to this business from the Solo client record; the client sees an honest paused or ended page under the business's name and never the platform shell; the owner re-invites an ended client through the existing invitation; first open, mid-session pause, routes that require a customer, more than one business, read failure, stale version, concurrent acceptance (40P01/55P03), refusal, restore blocked, not joined and identity change included.
PAIGE_UI_DESIGN: PASS: Impeccable SKILL.md, the OPERATE reference and reference/craft-floor.md read before each UI edit (round 1 and round 2); the owner card extends the record's own pg-token world, the customer page uses the incumbent customer tokens. Round 1 fixed five craft defects after one batched render. Round 2 re-rendered every frame in the real face (Schibsted Grotesk, loaded from the repo's own public/fonts and confirmed per frame) and fixed what the frames measured: the contact panel's filled primary chip and default primary confirm at 3.41:1 in dark (now one outline chip family and the inverse-ink confirm), 44px targets that were 39px (this workspace's root type is 14px, so min-h-11 is 38.5px; px minimums now), the paused chip's warning amber reading as a second gold in dark (now ink + glyph + dashed edge), and the record-header chip squeezed at 390px (now its own header row). Detector on CI's merge-base changed set (51 files, src/index.css not among them): 0 anti-patterns, 33 advisories. Single integrator critique, not Impeccable's two-assessment critique.
MATERIAL_FLOW_CHANGE: YES: owners gain "Portal access" (Pause / Restore / End, with a reason and an internal note) on the Solo client record, and Pause / Restore / End on the contact panel on every tier it mounts on (Solo, Sub-account, Enterprise); switching the panel off now opens the reversible Pause instead of deleting the person's login; customers whose access is paused or ended see their business's own page instead of the platform shell, and their old invitation link says the same instead of a generic error.
FLOW_PROTOTYPE: WAIVED: owner-decision=CLAUDE.md §4 pre-launch override 2026-09-05 and the owner's E09 Slice 7 decisions D1-D11 (2026-10-18); reason=no live customers and the owner fixed the flow; the owner reviews the live surfaces after merge.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a business owner withholds, gives back or ends one client's portal access to their business, reversibly and without touching that person's login or any other business; the client is told plainly where they stand.
VISUAL_DIRECTION: PASS: incumbent Solo record tokens and the shared radio primitive on the owner side; incumbent customer tokens and the shadcn Button on the customer side; gold only on Restore (the one act that gives access back); Pause is inverse ink, End is the destructive tone; no new palette, face or shell.
AUTOMATED_EVIDENCE: PASS: Integration round 3 (2026-10-19, rebased onto main a26efbcc9; section "Integration round 3" below): pgTAP on the composed migrations 200000+215000+220000 (main's followup_email_origin_admission)+225000 (Agreements, renumbered from 220000 on main)+230000+240000 — customer_portal_access_doors 113/113 (6 new cases; 3 migration bites each caught: replay keys removed, the contact predicate removed, the status predicate removed), customer_portal_access 214/214, customer_portal_access_delivery 29 PASS / 0 FAIL, operations_delivery_client_discovery 26 PASS and _review 29 PASS (no blanket grant), agreements 184/184, documents 244/244, payments 118/118, profile_consent 246/246, consent_parity 228/228, menu 104/104, messages 63/63, sessions 93/93, self_profile_write 74/74, contact_methods 102/102, contact_create_with_methods 23/23, customer_invitation_catalogue 14/14, team_authority_readiness 19/19; the same not-ok names as the base a26efbcc9 (same five migrations without 240000) under the local blanket grant: progress 110/112 (base 108/110) #106 #110, self_projection 182/183 #153, consumer_invite_acceptance 374/375 #211, governed_crm_commands 192/194 #4 #5. Vitest FULL suite in two worktrees, 4 shards each: head 1041 files, 17664 tests, 0 failed, 8 skipped; base a26efbcc9 1034 files, 17547 tests, 0 failed, 8 skipped. Fail-first: the new Files tests fail on the round-2 ClientFiles (3) and on the round-2 hook (2); 14 round-3 source mutations each fail a named test (table below). Deno 2.9.6: client-portal-access + client-portal-menu 53/53, agreements portal-door + wiring + crm client-file-share 48/48; 5 Deno mutations caught. node --test: c0b 209/209 after the round-3 renewal (29 dispatch scalars; 190/192 and a file-level failure before), sales-invoice-document portal 11/11. Integration round 2 (2026-10-19, section "Integration round 2" below, every run redone after a container restart): pgTAP customer_portal_access_doors 107/107 (fail-first 8 not ok on the round-1 migration; 17 migration bites each caught), customer_portal_access_delivery 29 PASS / 0 FAIL (2 bites caught), every other portal file equal to the base; Vitest head 91 files 1452 tests 0 fail (base b6d3bdf75 84 files 1344 tests 0 fail; round-2 tests on the round-1 source: 20 fail); Deno 53/53 and 48/48; node --test c0b 207/207, sales-invoice-document 11/11; harness 152/152 frames. Integration (s7-v2 over b6d3bdf75, 2026-10-19; section below): pgTAP on the composed migrations 200000+215000+220000+230000+240000 (220000 was Agreements before main renumbered it 225000) — customer_portal_access_doors 61/61 (37/61 without the section-12 gate: 24 fail-first; helper-predicate mutation 12 fail), customer_portal_access 214/214, customer_portal_access_delivery 26 PASS / 0 FAIL, and every other portal file equal to the base (b6d3bdf75, same four migrations without 240000): agreements 184/184, documents 244/244, payments 115/115, profile_consent 246/246, consent_parity 228/228, menu 104/104, messages 63/63, sessions 93/93, self_profile_write 74/74, contact_methods 102/102, contact_create_with_methods 23/23, customer_invitation_catalogue 14/14, team_authority_readiness 19/19, operations_delivery_client_discovery 26 PASS and _review 29 PASS (run without the blanket grant, as CI does); the same pre-existing not-ok under the local blanket grant on base and head (self_projection 182/183 #153, consumer_invite_acceptance 374/375 #211, progress 108/110 #105 #109, governed_crm_commands 192/194). Vitest on src/components/app, src/lib/portal, src/pages/app, src/components/client, src/components/tenant-relationships, src/pages/admin, the eight Spine tests and every changed test file: head 89 files, 1372 tests, 1371 pass, 0 fail, 1 skipped (base worktree b6d3bdf75, same filters: 82 files, 1278 tests, 1277 pass, 0 fail, 1 skipped); the composition's one failure (Slice 4's E4-S3 order pin) was fixed by placing the card after Files for {client}. Deno: client-portal-access + client-portal-menu 51/51; agreements portal-door + wiring + crm client-file-share 47/47. node --test: c0b-incumbent-resource-binding 64/64 after renewal (63/64 before), sales-invoice-document portal 11/11. Round 3 (slice head): the three touched files pass 39/39; each round-3 fix was written test-first and each new test fails on the round-2 source ("restore it later" in the pause confirm and the panel toast; tabular figures only on the Paused/Ended date, prose normal from the card root). Deno: the executor 17/17; the stale-approval test fails when the version sent is re-read at execution. pgTAP: customer_portal_access.sql 214/214 (round 3 adds agency team-list staff and the platform operator to the staff self-link guard; those 4 assertions fail on the round-2 migration), delivery 26/26, and every other pgTAP file that touches linked_user_id gives identical counts under the round-2 and round-3 migration (consumer_invite_acceptance 366, governed_crm_commands 194). Round 2: every touched test file passes except one pre-existing flake (below); 22 round-2 source mutations each fail their named test, one per fix (invitation status, panel Pause default, panel Restore gold, panel Pause present, two tier-neutral copies, the shared /app reader, the access-read retry, the spent invitation hidden, the header chip, the intake panel, the inbox fact, the roster and inbox pre-migration fallbacks, the approval card name, reason and no-one-click description, End success offer, the impersonation strings pinned to the migration, the paused chip glyph, the customer contact line, the panel paused badge hue). Round 1: fail-first 19 cases in 8 files; nine source mutations caught. FULL SUITE: UNVERIFIED — the round-1 claim that "full-suite base-versus-branch counts are recorded in the PR body from two worktree runs" was false (the base run was killed at about 27 minutes under contention). The measured comparison is scoped to the touched folders (components/tenant-relationships, components/admin, components/app, hooks, lib, pages, contexts): round 2, measured in two git worktrees at the same time (base 1cc4e9950, this head): base 204 files, 2849 tests, 0 failed (1 skipped); this head 211 files, 2941 tests, 1 failed (1 skipped) — the one failure is the pre-existing flake below. Round 1 had measured base 2849 / 7 failed and branch 2913 / the same 7 under heavier load. The workspace test "makes only the covered narrow list inert" is order- and load-dependent: measured in worktrees, full file 4 runs each, base 1cc4e9950 failed 2 of 4 and this head 3 of 4; run alone it fails 3 of 3 on base too.
STATIC_EVIDENCE: PASS: Integration round 3 (head over a26efbcc9): tsc ratchet no new type errors (baseline 10, current 6); baseline-guard ok (10 → 10 sigs, alias 52 → 52); ESLint on the changed-src set (59 files) 0 errors, 8 warnings; check-source-utf8 clean; Impeccable 4.1.0 detect on the 21 changed UI files rc 0, 0 anti-patterns (34 advisories), and on all of src 81 anti-patterns at head and at base (identical count; none in a changed file); every lint:* script passes except lint:gold (byte-identical failure on base, BusinessCreditDashboard.tsx, untouched) and lint:impeccable over all of src (exit 2 on base too); lint:migration-versions now passes (1353 migrations, no version reused — the round-2 collision is gone on main); PAIGE Spine registry lint PASS (225); consent-parity-gen --check matches; deno-edge-ratchet over the 22 affected edge functions (base a26efbcc9 vs head): no new or increased diagnostics. Integration: tsc ratchet no new type errors (baseline 10, current 6); ESLint on CI's changed-src set (49 files) 0 errors, 8 warnings; gold-discipline clean; check-source-utf8 clean; Impeccable 4.1.0 detect on the changed UI set rc 0 (advisories only); lint:definer-fns, lint:views (16), lint:tier-features (2183 files), lint:migration-versions (1352), action-risk-lint (193 classified), PAIGE Spine registry lint (225 capabilities, self-test PASS) and consent-parity-gen --check all pass; deno-edge-ratchet over the 22 affected edge functions (base b6d3bdf75 vs this head): no new or increased diagnostics (paige-ai-chat 9 = 9, skill-runner 3 = 3, the rest clean); capability-kit lint, its self-test and its 39 focused cases pass; all c0b CI tests (node --test scripts/ci/c0b-*.test.mjs) 207/207; the 29 incumbent dispatch pins renewed once more against the composed bytes after an additive-only review (paige-ai-chat delta = Slice 7's own 84 added lines, 0 removed; only identity input 15 differs; action-risk.ts pin already the reviewed digest). Slice: tsc ratchet shows no new type errors (baseline 10, current 6 on this checkout); ESLint 0 errors on the round-2 changed src files (7 warnings, none new in kind); check-source-utf8 passes on the changed set; Impeccable 4.1.0 detect on CI's exact merge-base changed UI set: 0 anti-patterns (33 advisories); capability-kit lint, PAIGE Spine registry lint (222 capabilities) and all c0b CI tests (203 pass, 0 fail) pass after the 29 incumbent pins were renewed for the two-line approval-card change, and again in round 3 after a second bounded renewal (the access_version result fields, decomposed: only identity input 15 moved, inside this slice's branch; dated note in the script); Deno test for the executor 17/17 (round 3). lint:gold's single BusinessCreditDashboard finding is pre-existing on base. Exact-head hosted CI is required before merge.
RENDERED_EVIDENCE: PASS: integration round 3 (2026-10-19) re-rendered all 152 frames at the final head over a26efbcc9 — 152 pass, fontLoaded true in 152, lowest contrast 5.25, 0 stray gold; the confirm-pause and confirm-end frames now also require the signing-link line, and the Invite again frames the new copy (both checked by eye in the light 1440 frames). integration round 2 (2026-10-19) re-rendered all 152 frames at this head after updating the harness to the integrated card order and stubbing the Files read — 152 pass, fontLoaded true, lowest contrast 5.25, no stray gold; the paused and ended frames now also check the Files for {client} line. round 3 re-rendered every frame at this head (round 2's set; round 3 changed the pause copy, the card's figure style and the gold check) — 152 frames, 152 pass, fontLoaded true in all 152, lowest contrast unchanged at 5.25 light / 6.85 dark, 0 stray gold with gradient stops now graded (8 panel frames carry the gold gradient Restore, each the act). Round 2 re-rendered every frame at its head (scripts/live-drive/harness/portal-access-mount; real components and CSS, synthetic data, network blocked): 152 frames, 152 pass. The round-1 frames predated commit 3af4b12a5 and were judged in a fallback face (fontLoaded false in all 72); the harness now declares Schibsted Grotesk from the repo's own public/fonts, waits for document.fonts.ready, and refuses any frame whose face did not load — fontLoaded is true in all 152. Owner record: 16 states (round 1's 13 plus "Shared with" while paused and the header chip paused/ended) in light and dark at 1440x900 and 390x844, paused and the pause confirm at 1366x768 and 1536x770, and paused, the pause confirm and the header chip at 1024x768 and 900x1000. Contact panel: joined, paused, ended and each confirm, on Standalone Solo, with joined on Sub-account and Enterprise and the pause confirm on Sub-account. Portal dashboard: Client access with every row and filtered to Access paused. Customer: paused, ended, mid-session pause and paused with the business's light/dark logo. Old invitation link: paused and ended. Every frame measures AA text contrast against the composited background (gradient fills graded against every stop; lowest 5.25 light, 6.85 dark), no overflow or clipped text, gold only on Restore or the reused invitation command's act, 44px phone targets (only the modal's controls while a modal is open), no platform shell on the customer pages. Self-test: eight harness-only mutants (gold on Pause, gradient gold on Pause, low contrast, small target, overflow, success before the re-read, the shell shown to a paused customer, the real face withheld) are each caught. The Slice 1 inbox harness gained a paused state (light and dark, 1366x768 and 390x844): the held Portal channel, the inline notice and Send held all pass and the E09 roots measure 5.47 light / 7.7 dark with no gold; that harness's whole-inbox gates fail identically on main's not-joined state (pre-existing, recorded under UNVERIFIED). Frames were viewed by the integrator. Wide punctuation in the real face ("Aug 28 , 2026", "$3 , 500") comes from `font-variant-numeric: tabular-nums` on the `[data-tenant-shell]` root on main, the defect `src/index.css` documents with this face; it is a known main defect on every Solo surface, not an open question about production, and removing it is a separate task (master §5). Round 3 stopped this slice's own prose inheriting it: only the Paused/Ended date keeps tabular figures. The stray-gold check grades background-color, text and border colour, and since round 3 also every gradient colour stop (the shared gold Button is a gradient); an eighth self-test mutant (a gradient gold on Pause) is caught, and was missed by the round-2 detector.
BEHAVIORAL_EVIDENCE: PASS: round 3: Files for {client} follows the record's live access props (paused → restored re-render drops the paused line with no new read and never says "hasn't joined") and the share answer's portal_access (paused or ended in another tab, while the record thinks open); a Pause then Restore outranks an earlier share answer; the reach card re-reads when the access state changes; Paige's three share notes never claim visibility when portal_connected is missing. Round 1-2: component tests drive pause, restore and end through the real UI with the exact writer arguments (actor, current workspace, contact, action, reason, trimmed note, the version read as `since`), success only after a fresh read, an acknowledged write the read does not reflect reported as unconfirmed, ACCESS_CHANGED and 40P01 re-reading, refusal, restore blocked, an account change sending nothing, invite again through the existing manager with the link cleared and without the spent joining invitation; the contact panel offers Pause and End to a joined client, its switch opens Pause, Pause can step up to End, Restore is gold, and admin-delete-user is never invoked; the frame hook names paused/ended on first open, mid-session, on requireCustomer routes and after 42501, retries a dropped access read once on its own deadline, and the /app gate provides one reading that the home and chat share (one frame and one access read per page); the old invitation link answers paused/ended with the business's words and Sign out, never the portal; the landing route and gateway send a paused or ended client to that page; the inbox holds a portal reply to a paused client with tier-neutral copy; People and the inbox re-read without the new columns if the database does not have them yet (42703); the inbox context pane and the intake panel name paused/ended; Paige's approval card names the client and the reason.
AUTHENTICATED_RUNTIME: UNVERIFIED: the server contract (migration 20271110240000, set_client_portal_access, read_client_portal_access, client_portal_access_state, the resolver predicate, the section-12 gate) is proven only by local pgTAP inside rolled-back transactions on the composed migrations and is not applied to production; no owner pause/restore/end and no customer paused/ended page were driven on production. Owed after merge on a seeded test tenant, then the QA relationship sequence (D11) by that business's owner.
KEYBOARD_FOCUS: PASS: every control is a native button or the Radix radio group with indigo focus rings; opening a confirm moves focus to its heading; Cancel returns to the actions. Physical assistive technology untested.
ZOOM_REFLOW: PASS: 390px frames reflow (actions stack full width, the confirm's buttons stack with the act first) without horizontal overflow; browser 400% zoom not exercised.
REDUCED_MOTION: PASS: the confirm and notes fade only under prefers-reduced-motion: no-preference; the skeleton pulse stops under reduce; buttons drop their transition under reduce.
STATE_COVERAGE: PASS: owner card — loading, joined, not joined, paused (since, by, reason, team note), ended, restore blocked, pause/end/restore confirm, confirmed pause, ACCESS_CHANGED, unconfirmed, refused, unavailable, not found, no workspace, error with retry, invite again; record header chip paused/ended; Shared with paused line; contact panel joined/paused/ended and each confirm on Solo, Sub-account and Enterprise; Portal dashboard all rows and filtered to Access paused; inbox held channel; customer — paused, ended, mid-session pause, paused with the business's light and dark logo, old invitation link paused/ended, more than one business (unchanged Slice 8 refusal), nothing recorded (unchanged), reader missing (unchanged), an access read that still fails after its one retry (the gate does NOT withhold the shell — it renders the /app shell, and the chat panel says “We couldn’t check your access just now.”; only the not-client platform persona is kept out; corrected round 2, compliance 7), sign-out that does not happen (round 2: "You’re still signed in. Try signing out again." and the button works again, never stuck on "Signing out…"). Round 2 owner states: Files for {client} paused and ended lines and their share confirmations, Shared with {client} ended line, How {client} can be reached Portal row open / paused / ended / not joined, the Invite again copy naming everything a new acceptor sees.
TRUTHFUL_STATE_LABELS: PASS: a change is reported only after a fresh read shows it; the dashboard, the inbox context pane and the intake panel read Access paused / Access ended before any "linked" or "accepted" wording; the confirm says history stays on the contact, that End hides what the person connected under their own login until they rejoin, that open invitations stop working, that emails and texts are not affected and that nobody is emailed; nothing says "nothing is deleted", "one click" or "exactly as before"; End's success offers another invitation only when one is allowed; the paused summary says the client finds out when they next open the portal; the customer page says only portal messages and files are kept and does not point to a contact channel it cannot show; Paige's approval card names the client and the reason.
SOLO_UI: YES: "Portal access" lives on the shared Solo client record behind the existing client_standing gate and the customer_portal_invite feature; no account-specific path.
SOLO_1536X770_PAIGE_CLOSED: PASS: owner paused and the pause confirm, light and dark, wide-1536x770, pass every check in the real face.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: the harness mounts the record without the PAIGE dock; owed to an authenticated Solo drive with PAIGE open.
SOLO_1366X768_PAIGE_CLOSED: PASS: owner paused and the pause confirm, light and dark, laptop-1366x768, pass every check in the real face.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: the harness mounts the record without the PAIGE dock; owed to an authenticated Solo drive.
SOLO_1024X768_PAIGE_CLOSED: PASS: owner paused, the pause confirm and the header chip, light and dark, compact-1024x768, pass every check in the real face (PAIGE dock not mounted in the harness).
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_900X1000_PAIGE_CLOSED: PASS: owner paused, the pause confirm and the header chip, light and dark, tall-900x1000, pass every check in the real face (PAIGE dock not mounted in the harness).
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
UNVERIFIED: the migration is not applied to production (local rolled-back proof only); the between-resolver-and-lock race is simulated in one session (a resolver that reads before the pause), not driven with two concurrent sessions; authenticated owner pause/restore/end, the contact panel and the customer page on production; the chat approval card is proven by unit test and source, not by a rendered chat; the record with the PAIGE dock open at every width; screen reader; browser 400% zoom; the accepted round-3 residual E09-S7-T3 (a portal signing link opened between agreement-send's token write and its sent event survives a later pause; master §5); the harness does not stub the reach card read, so its frames show its error state and the Portal row is proven in Vitest only; the customer page cannot show the business's public contact or brand accent until client_portal_access_state returns them (backend field, logged in master §5); the record header at 390px still compresses the client's name to a glyph and clips the tabs — pre-existing on main, not caused or fixed here, owed as a follow-up; the Portal dashboard's own phone targets (tabs 43px, toolbar 40px, row buttons 28px) are main's and are reported, not gated, in the portal frames; the whole-inbox gates in the Slice 1 harness (decorative gold, "You:" 2.43:1) fail identically on main's not-joined state and are not this slice's.

OWNER_INTENT: A business can pause, restore or end one joined client's portal access to that business from the client record, reversibly, without deleting anything or touching that person's login or any other business; the client sees plainly that their access is paused or has ended, under the business's name, never Paige's platform desk.
MUST_NOT_HAPPEN: No Auth user is deleted and no other business is touched by an access change; the client never sees the reason or the team note; a paused or ended client never sees the platform shell, the Support desk or the platform persona; success is never shown before the server confirms it; the owner never messages a paused client through the portal; an ended client never reads as "Invitation accepted".
MUST_PRESERVE: Invitation send, cancel and history (PortalInvitationManager, PortalInvitationCommand), Force sign out and Send password reset on the contact panel, the approved owner Portal dashboard, Shared with {client}, the customer shell for open customers, staff and non-customers, Slice 8's refusal for more than one business, and the gateway's refusal for another business's open customer.
ACCEPTANCE_CRITERIA: The owner pauses a joined client with a reason; the card reads Access paused with when, by whom and why; the client's next open shows "Your access to {Business} is paused."; the owner restores and the client sees the portal again; the owner ends and the client sees "has ended"; the owner invites again through the existing invitation.
MOTION_PURPOSE: STATE: the inline confirm and the result note fade in to mark a state change; no other motion.
PROTECTED_SEAMS: set_client_portal_access is the only writer and the tenant is always the caller's current workspace (§59); the customer read is keyed on auth.uid() only; admin-delete-user is no longer reachable from the portal access switch; the shared confirm copy lives in one home (src/lib/client-portal-access.ts).

INTERNAL_BUILD_IDENTITY: b6d3bdf754bed023b1d1b60c917801cb2aeaafd1 (the integration base; the slice's code is the one squash commit on s7-v2 above it, from slice7-access e88971a26c75915ad165afb6713cfd86fc49336e, originally on main 1cc4e9950214b344237f921e65b3b5fccb7f68ae); deployment=NOT_DEPLOYED; environment=local; branch=s7-v2 (squash of slice7-access e88971a26 over s7-integrate b6d3bdf754bed023b1d1b60c917801cb2aeaafd1 = main d44ad08 + Agreements #2367 + Payments); migrations=PROOF_OWED(20271110240000 persisted apply on production after merge); edge=PROOF_OWED(paige-ai-chat, paige-mcp and paige-mcp-consent deploy readback after merge); evidence=scripts/live-drive/harness/portal-access-mount
RELEASE_CHANNEL: development: branch; production deployment, migration persisted-apply and edge readback are verified after merge.
RELEASE_CLASSIFICATION: internal-only: seventh slice of the Customer Portal; no customer release until all seven pillars and authenticated proof exist.
CUSTOMER_RELEASE_IDENTITY: none: pre-launch; no customer release named until the seven pillars and authenticated proof exist.
RELEASE_NOTE_REQUIRED: NO: pre-launch internal increment.
RELEASE_TRUTH_BOUNDARY: PARTIAL: local automated and harness-rendered frontend proof and local composed-migration pgTAP/Deno; hosted CI, production migration apply, edge readback and authenticated runtime proof owed.
RELEASE_RECOVERY: position=forward-fix — the migration is additive (columns default open, a guard trigger, new RPCs, a resolver predicate) and the frontend degrades to today's behaviour while the access reader does not exist; reference=supabase/migrations/20271110240000_e09_customer_portal_access.sql

## Integration onto s7-integrate b6d3bdf75 (2026-10-19)

Branch `s7-v2` = `git merge --squash e88971a26` (slice7-access round 3) onto `s7-integrate` b6d3bdf75
(origin/main d44ad08 + Agreements #2367 migration 20271110220000 + Payments squash 20271110230000). Round 3
rebased the four Slice 7 commits onto main a26efbcc9, where Agreements is `20271110225000` (section below).
Twelve files conflicted; each was resolved by hand: docs and the spine workflow keep both sides' entries;
the binding-ledger `customer.portal` row keeps main's `state_reason` and appends Slice 7's sentence (restated
to the integrated truth) with the union of both `sources`; `TenantRelationshipsClientsWorkspace.tsx` keeps
main's Files for {client} and How {client} can be reached sections and Slice 7's access card and access-aware
Shared with; `ContactPortalPanel.tsx` keeps main's held-invitation imports and Slice 7's access imports;
`registry.ts`, `client_portal.ts` and `paige-ai-chat/index.ts` keep both sides' declarations and imports; the
29 incumbent pins took main's side and were then renewed against the composed bytes (below).

**Migration renumbered** `20271110110000` → `20271110240000` (`git mv`; every reference in code, tests, docs
and evidence updated; the Documents evidence line that records a historical run of 110000 is left as written).
`lint:migration-versions`: 1352 migrations, no version reused.

**Function-by-function diff.** Each object the migration (re)defines was compared with its newest definition
across every migration on b6d3bdf75 (highest version wins), and separately with its newest definition at
Slice 7's own base 1cc4e995. No later migration (070000, 080000, 200000, 215000, 220000 — Agreements then, 225000 on main now — 230000) rewrites a
function dynamically (no `pg_get_functiondef`/`EXECUTE replace`), and none of them re-grants a restated
function (215000's anon REVOKE on `admin_propose_paige_actions` survives: Slice 7 restates no grant on it).
Result: 39 function bodies — 9 new, 29 whose newest body is unchanged since 1cc4e995 (so the Slice 7 copy
carries only its own delta), and 1 changed after it (`operations_delivery_client_read_scoped`, Documents
200000), whose Slice 7 copy already equals Documents' body plus the one predicate. **Reverts caught: 0.**
Bodies that 20270504000000 rewrote in place (the coach-role retirement: `get_client_rail`,
`get_client_rail_for_chat`, `can_access_rail_topic`, `admin_propose_paige_actions`) are restated from the
live text, so they read differently from their last literal migration but match what that rewrite produced.

| Object | Newest prior definition on b6d3bdf75 | Slice 7 delta | Action |
|---|---|---|---|
| `_clients_portal_access_guard()` | none (new) | new (access-column write lock, derived link transitions, merge refusal) | kept (new object) |
| `client_portal_relationship_id(uuid)` | 20271102120000 | +1 predicate `portal_access_state = 'open'` | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `client_portal_access_open(uuid)` | none (new) | new (delegates to the resolver) | kept (new object) |
| `_client_portal_access_projection(uuid,uuid)` | none (new) | new | kept (new object) |
| `_client_portal_access_authorize(uuid,uuid,boolean)` | none (new) | new | kept (new object) |
| `read_client_portal_access(uuid,uuid)` | none (new) | new | kept (new object) |
| `set_client_portal_access(uuid,uuid,uuid,text,text,text,timestamptz)` | none (new) | new | kept (new object) |
| `client_portal_access_state()` | none (new) | new | kept (new object) |
| `get_client_rail(uuid,integer,text)` | 20261044000000 | linked-subject arm through client_portal_access_open (body is the 20270504000000 role-retirement rewrite as live) | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `get_client_rail_for_chat(uuid,integer)` | 20261044000000 | same as get_client_rail | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `can_access_rail_topic(text)` | 20260712250000 | subject arm through client_portal_access_open (20270504000000 rewrite as live) | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `get_client_service_agreement()` | 20260710030000 | + client_portal_access_open(c.id) | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `get_workspace_brand()` | 20260630194059 | + client_portal_access_open(c.id) | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `get_paige_persona_context()` | 20261019000000 | + client_portal_access_open(c.id) | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `is_program_client_owner(uuid)` | 20260702184358 | + AND client_portal_access_open(_client_id) | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `load_self_context()` | 20260702025123 | + portal_access_state = 'open' | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `customer_paige_activity_summary(integer)` | 20260702025123 (declared `int`) | + portal_access_state = 'open' | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `can_access_contact(uuid,uuid,boolean)` | 20271108201000 | linked-customer arm + portal_access_state = 'open' | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `client_portal_invite_status(text)` | 20271108120000 | reports paused / ended; ended keyed on former_user_id | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `ensure_client_role_self_heal()` | 20260701005309 | + portal_access_state = 'open' | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `operations_delivery_client_read_scoped(uuid,uuid,uuid)` | 20271110200000 (Documents) | + c.portal_access_state='open' on Documents' body | REBASED CHECK: Slice 7 already restated Documents' body; diff vs 200000 is the one added predicate — kept, comment corrected |
| `operations_delivery_client_reviews_scoped(uuid,uuid,integer)` | 20271031005020 | + portal_access_state='open' in the two gates and the candidate join | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `comms_portal_reply(uuid,uuid,text,uuid)` | 20271110010000 | refuses PORTAL_ACCESS_PAUSED | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `admin_propose_paige_actions(uuid,jsonb)` | 20260710070000 | notifies the linked person only while open (215000 anon REVOKE preserved: no grant restated) | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `notify_client_on_readiness_approval()` | 20260702001451 | notifies only while open | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `start_client_impersonation(uuid)` | 20270519010000 | names paused / ended | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `_create_client_with_contact_methods(uuid,jsonb,jsonb)` | 20270519005000 | refuses portal_access_* keys | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `list_tool_autonomy(uuid)` | 20271110060000 | wrapper adds client_portal_access_set (original renamed _list_tool_autonomy_before_portal_access) | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `client_portal_send_message(text,uuid,text,uuid)` | 20271110010000 | + open predicate in the locked re-check | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `client_portal_session_change_admit(uuid,text,uuid,timestamptz,uuid)` | 20271110020000 | + open predicate in the re-check | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `client_portal_update_self_profile(timestamptz,jsonb,uuid)` | 20271102130000 | + open predicate in the locked re-check | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `client_portal_welcome_state()` | 20271107110000 | + open predicate in the locked re-check | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `client_portal_save_welcome(text,jsonb,jsonb)` | 20271107110000 | + open predicate in the locked re-check | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `client_portal_begin_file_upload(uuid,uuid,text,text,bigint,uuid)` | 20271108150000 | + open predicate in the locked re-check | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `client_portal_finish_file_upload(uuid,uuid)` | 20271108150000 | + open predicate in the locked re-check | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `client_advance_onboarding_stage(text,jsonb)` | 20271106120000 | + open predicate in the re-check | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `paige_chat_thread_create(uuid,text,text,jsonb)` | 20271108201000 | + open predicate in the locked re-check | kept: newest body unchanged since 1cc4e995, so the Slice 7 copy carries only its own delta |
| `_clients_link_caller_is_team(uuid)` | none (new) | new | kept (new object) |
| `_clients_portal_link_not_staff_guard()` | none (new) | new | kept (new object) |
| `customer_respond_to_action(uuid,text,text,timestamptz)` (DO block over pg_get_functiondef) | 20271108122000 (composed in place) | + open predicate in the locked re-check; refuses unless the E09 scope marker and exactly one copy of the re-check exist | kept: no later migration touches it |
| policy `signed_agreements_read` on storage.objects | 20260808170000 | linked-customer arm through the resolver | kept: no later definition |
| trigger `trg_clients_portal_access_guard`, `trg_clients_portal_link_not_staff` on clients | none (new) | new | kept; no name collision with 215000's three clients triggers |
| columns `clients.portal_access_*`, CHECKs, index `clients_portal_access_former_user_idx` | none (new) | new | kept; 200000–230000 add no clients column |
| `_client_portal_lock_relationship(uuid,text)` | none (new, integration) | the one open-access gate (section 12) | added |
| 9 customer doors (section 12): `client_portal_documents`, `client_portal_can_upload_file_object` (200000), `client_portal_communication_preferences`, `client_portal_set_communication_preference`, `client_portal_set_shared_context_consent` (215000), `client_portal_agreements`, `client_portal_open_agreement_signing`, `client_portal_agreement_document_scope` (225000; 220000 before main renumbered it), `_client_portal_billing_client` (230000) | the version named | resolver call -> the shared helper (the two Profile & Consent writers also re-prove under their lock after the advisory key) | restated from the newest body byte-for-byte plus that change (generator asserts exactly one match and no remaining bare resolver call) |

**The open-access gate (section 12).** The resolver predicate already refuses a paused or ended person on a
plain call to every door Documents, Profile & Consent, Agreements and Payments added — but each of those doors
re-proves the customer under a row lock *without* the access state, so a pause committed between the
resolver's read and the lock let that call through. One helper, `_client_portal_lock_relationship(p_tenant_id,
p_lock)` (`share` | `update` | `none`; internal, no API role may call it), runs the resolver and re-proves the
same row open, active, unmerged, in an active business and linked to `auth.uid()` under the caller's lock, with
the predicate written once. Gated doors (each restated from its newest body with only the resolver call
replaced; a generator asserts one match and no remaining bare resolver call):
`client_portal_documents` and `client_portal_can_upload_file_object` (`none`: STABLE, one snapshot);
`client_portal_communication_preferences` (`share`); `client_portal_set_communication_preference` and
`client_portal_set_shared_context_consent` (`none` first, then `share` / `update` right after their advisory
key — the staff pause/lift RPC takes the same key then a key-share on the contact, so locking the row before
the key could deadlock); `client_portal_agreements`, `client_portal_open_agreement_signing`,
`client_portal_agreement_document_scope` (`share`); `_client_portal_billing_client` (`share`; serves
`client_portal_invoices`, `client_portal_invoice_ledger`, `client_portal_invoice_payment_request` and the
`portal=1` document door). Every refusal keeps its code and shape (§37: each door already answered a NULL
relationship; the hooks and edge doors reading them see the same answers). Payments' stricter guards
(same-business staff, platform owner, deleted/banned) stay Payments-only — extending them changes who reads
Documents, Agreements and settings, an owner decision. The released-work doors and section 10's writers keep
their inline predicate (not rewritten; they predate this gate and are proven by their own tests).

**Fail-first.** `supabase/tests/customer_portal_access_doors.sql` (61 assertions: helper shape, each door
calls the helper, then open / paused / ended / a pause after the resolver read / restored for all 11 reads and
writes). On the composed migrations WITHOUT section 12: 37 pass, 24 fail (the 11 structural checks, all 11
late-pause doors, and the two helper checks). With it: 61/61. Mutation (helper predicate removed): 12 fail
(every late-pause door and the helper). Paused and ended on a plain call already pass before the gate (the
resolver), so those rows are regression pins, not fail-first.

**Solo record placement.** Slice 4 pins Files for {client} directly under Shared with (`E4-S3` workspace
test, which failed on the first composition). The Portal access card now follows Files for {client}; the
Slice 7 placement test asserts that order. The harness frames mount the card itself, so no frame changed.


## Integration round 2 — verifier and compliance fixes (2026-10-19)

The round-1 verifier (SHIP, four findings) and compliance officer (HOLD, eleven items) both read head
f4aeb371b. Every fix below was written test-first; "fail-first" counts are the new tests run against the
f4aeb371b migration (or source), and "bite" is a deliberate mutation of the fix that the test catches.

**Server (migration `20271110240000`, new section 13 plus three edits).**
- *Owner answers said "can see it" from the login link alone (compliance 1, 2).* `client_file_set_client_share`,
  `plan_item_set_client_share` and `client_file_owner_list` now answer `portal_connected` = linked AND access
  open; the two share replies and `read_client_communication_state` add `portal_access`
  (`open | paused | ended | not_joined`, one internal wording function `_client_portal_access_word`). The file
  list keeps exactly its keys (its reader is exact). §37 consumer inventory: Files card + `useClientFilesOwner`
  (reads `portal_connected` by name), Shared with, the reach card and its exact reader (now accepts
  `portal_access` and still accepts its absence), `_shared/crm/client-file-share.ts`,
  `_shared/planning/scoped-write.ts`, Paige's three share confirmations, the Documents / Progress / Profile &
  Consent pgTAP pins (updated for the new key), the two harness stubs (unchanged, still valid). Deploy order:
  a frontend older than this change refuses a reach answer carrying the new key (exact keys) and shows its
  read error until the frontend deploys — honest, never a false state; the migration and the frontend ship in
  one merge.
- *A portal-issued signing link outlived a pause (verifier 3; INTEGRATOR DEFAULT S7-D1, owner may
  overrule).* `set_client_portal_access` pause and end clear the token of every counterparty signing link the
  portal issued for that relationship (its latest `agreement.portal_link_issued` is no older than the
  business's latest `sent`/`resent` for that signer); `token_expires_at` and `token_revoked_at` stay, so a
  restored client's next portal link can only keep or shorten the deadline and the business can still resend.
  A link the business emailed and the portal never replaced is untouched. The audit adds
  `signing_links_revoked`.
- *`operations_delivery_client_reviews_scoped`'s candidate-join predicate is removed (verifier 2):* the opening
  gate proves the person's one row open, `read_scoped` refuses each row whose client is not open, and the
  closing gate refuses the whole answer if a pause lands during the loop, so that predicate could change no
  outcome and no test could ever see it removed. The two gates are now each pinned.
- *`load_self_context` / `customer_paige_activity_summary` (verifier 2):* the predicate is NOT redundant — a
  team member linked as their own business's client (the §58 self-link path, E09-S7-T2) reads the row through
  the staff policy, where only this predicate refuses a paused link. Kept, comment corrected, now tested.

**Owner and customer UI.**
- Files for {client}: takes the record's access state; paused reads "Paused — {first} can’t see shared files
  right now. They show again if you restore their access."; ended reads "{first}’s portal access has ended, so
  they can’t see shared files. They show again if you invite them back and they accept."; the share
  confirmation never says "can open it" for either, even against an answer that reports the link alone.
- Shared with {client}: an ended client reads "has ended", no longer "hasn’t joined your portal yet".
- How {client} can be reached → Portal: Joined / "Joined · access paused, so they can’t open the portal" /
  "Access ended · they need a new invitation to come back" / Not joined yet.
- Invite again (compliance 5): "Whoever accepts sees what this client’s record holds in your portal: earlier
  messages, shared work and files, invoices issued to this client, and agreements that name them as a
  signer. Their earlier invitations no longer work."
- Customer paused / ended page (compliance 6): when `performSignOut` reports it did not sign out (an open
  act-as refused or unknown, or a sign-out already running) or the gateway lookup throws, the page says
  "You’re still signed in. Try signing out again." and the button works again.
- Paige (chat): the file share, re-file and work-item share confirmations say "can open / can see it now"
  only when the writer's `portal_connected` is not false, and otherwise append why (`portalUnseenNote`:
  paused, ended or not joined). Unsharing no longer appends "they'll see it once they join".

**Signed links (compliance 9).** Documents' customer file links last 60 seconds (`DOCUMENT_LINK_SECONDS = 60`,
`src/hooks/useClientDocuments.ts`) and are minted only after `client_portal_documents` re-proves open access; the signed-agreement download
and the portal invoice document are streamed per request through `client_portal_agreement_document_scope` and
the `portal=1` door, each re-proving open access. So a link handed out before a pause stops within 60 seconds
or on its next request. Not driven against production Storage (UNVERIFIED below).

**Record wiring (resumed run, 2026-10-19).** A source bite showed two wirings no test caught: handing Files
for {client} the login link alone again (`portalConnected={Boolean(person.linkedUserId)}`, the exact round-1
defect) and dropping `portalEnded` from Shared with {client}. `TenantRelationshipsClientsWorkspace.test.tsx`
now pins both props on the record's mounts (source pin, like that file's other mount pins; the cards' own tests
drive each state), and Shared with's ended case now gets a share answer that reads the link alone
(`portal_connected: true`), so the record's ended state must win, as it already must for paused. Each bite now
fails one test.

**pgTAP (local, one rolled-back transaction per file; the composed Documents, Profile & Consent, Agreements,
Payments and Slice 7 migrations; every run redone from scratch after a container restart).**
- `customer_portal_access_doors` 107/107 (61 at round 1). Fail-first, the same file against the round-1
  migration (f4aeb371b): 99/107, 8 not ok — 82, 83, 85, 90 (the portal-issued signing link) and 103, 104, 105,
  107 (the owner's share answer, file list and reach card). The other new cases pin behaviour that already held
  and are proven by the bites below.
- Bite sweep, one mutation of the 240000 migration each, all 17 caught: Profile & Consent preference re-check
  under the lock removed → 62 (the stand-in helper pauses right after the writer's first call; the refusal must
  be the re-check's, with exactly 2 helper calls); consent re-check removed → 63; `client_portal_save_welcome`
  locked re-check predicate removed → 66; `load_self_context` predicate → 77; `customer_paige_activity_summary`
  predicate → 78; `ensure_client_role_self_heal` predicate → 71, 72; resolver predicate → 68 (the existing Cura
  thread through `paige_chat_customer_thread_authorized`, compliance 9); signing-link revoke disabled → 82, 83,
  85, 90; revoke widened to every link → 84, 85, 91 (the emailed link must survive); issue-order comparison
  inverted → 82, 83, 85, 90; an end that deletes the client's files → 97, 101, 103, 104, 105; an end that
  deletes the agreements → 89, 90, 92, 102, 103; share reply link-only → 104; file list link-only → 104; reach
  card's access word replaced by the link → 103, 104. `customer_portal_access_delivery` (run without the
  blanket grant, as CI does) 29 PASS / 0 FAIL (26 at round 1; 29 also on the round-1 migration — its three
  new cases pin the reviews gates, which already refused): `operations_delivery_client_reviews_scoped` opening
  gate predicate removed → "paused: the opening gate refuses before the page size is examined" fails (22023
  instead of 42501); closing gate predicate removed → "a pause landing mid-list is refused by the closing gate"
  is accepted.
- Section 12 runs the real `set_client_portal_access(...,'end')` and proves the invoice, its payment ledger
  row, all three agreements and their signers, and both files still exist and the owner still reads them
  (`read_sales_invoice`, `read_sales_invoice_payment_ledger`, the agreements table, the file list) while the
  customer reads none (compliance 3).
- Every other portal file, head (with 240000) against the base b6d3bdf75 (without it): access 214/214,
  agreements 184/184, consent_parity 228/228, documents 244/244 (base 244), menu 104/104, messages 63/63,
  payments 115/115, profile_consent 246/246 (base 246), sessions 93/93, self_profile_write 74/74,
  contact_methods 102/102, contact_create_with_methods 23/23, customer_invitation_catalogue 14/14,
  team_authority_readiness 19/19; operations_delivery_client_discovery 26 PASS and _review 29 PASS (no blanket
  grant). The same not-ok, by name, under the local blanket grant on base and head: progress "signed-in
  callers cannot read the proposer or the raw payload" and "the customer cannot select the proposer" (head
  110/112, base 108/110 — round 2 added two cases), self_projection #153 (182/183), consumer_invite_acceptance
  #211 (374/375), governed_crm_commands #4 #5 (192/194).

**Other gates at this head (all redone).** Vitest on src/components/app, src/lib/portal, src/pages/app,
src/components/client, src/components/tenant-relationships, src/pages/admin, the eight Spine tests and every
test file changed since b6d3bdf75: head 91 files, 1452 tests, 1451 pass, 0 fail, 1 skipped; base worktree
b6d3bdf75, same filters: 84 files, 1344 tests, 1343 pass, 0 fail, 1 skipped. Fail-first: the round-2 test
files (and the fixture) on the round-1 source f4aeb371b: 178 tests, 20 fail, each on a round-2 fix. Source
bites at head, each caught: Files confirmation ignoring the record's state (2 fail), Files paused/ended line
removed (1), Files/Shared with wiring on the record (1 each, above), the paused page's sign-out reset removed
(2), the reach card's paused wording removed (1), Shared with's ended guard removed (1), a chat work-item share
confirmation that ignores `portal_connected` (Deno, 1). `ci:tsc` ratchet: no new errors (baseline 10, current
6). ESLint on the 57 changed src files: 0 errors, 8 warnings (round-2 files: 0). Impeccable detect on the 59
changed UI files: 0 anti-patterns, 34 advisories. UTF-8 check clean. Deno (2.9.6): client-portal-access +
client-portal-menu 53/53; agreements portal-door + wiring + crm client-file-share 48/48; edge ratchet over the
22 affected functions: no new or increased diagnostics. node --test: c0b-incumbent-resource-binding 64/64, all
c0b tests 207/207, sales-invoice-document portal 11/11. Lints: definer-fns, views (16), tier-features (2183),
action-risk (193), governed-execution, mcp-governed-door (117), action-authority, write-targets (186),
tool-catalogue, readiness-copy, solo-parity, pg-tokens, Spine registry (225, self-test pass), consent-parity
check, capability-kit (lint, self-test 40, focused 39) and capability-declaration — all pass.
(Round 3: resolved — rebased onto main, `lint:migration-versions` passes.) `lint:migration-versions` FAILS on head and on the base b6d3bdf75 alike: main now holds
`20271110220000_followup_email_origin_admission.sql`, so Agreements' version collides; its PR already renumbered
it to `20271110225000`, and the integrator rebases onto that at release (nothing in this branch changes it).
`lint:gold` FAILS identically on base and head on `src/components/dashboard/BusinessCreditDashboard.tsx:271`,
a file this branch does not touch. No pinned Spine byte changed in the resumed run, so no pin was renewed
again (the 29 renewed in 293aea30d stand; c0b 64/64).

**Rendered (harness, this head).** `scripts/live-drive/harness/portal-access-mount` re-rendered all 152 frames:
152 pass, fontLoaded true in all, lowest contrast 5.25, no stray gold, no console errors. The harness had gone
stale at the round-1 integration: it still required the access card directly under Shared with, so 56 owner
frames failed on order alone, and the Files card's read was unstubbed. It now expects Shared with → Files for →
Portal access (the integrated order Slice 4 pins), stubs `client_file_owner_list` with `portal_connected` =
linked AND open, and checks the Files line on the paused and ended frames; handing Files the link alone again
fails the paused frame ("hasn’t joined your portal yet" instead of the paused line). The Invite again frames
carry the round-2 copy. Not rendered: the sign-out failure line on the customer page and the reach card's
Portal row (Vitest only).

**UNVERIFIED (unchanged).** Hosted CI, the production migration apply, the edge readback, authenticated owner
and customer runs, and a two-session race (simulated in one session).

## Integration round 3 — verifier, compliance and security fixes; rebased onto main (2026-10-19)

Both round-2 reviews read b8334722b and held. Round 3 rebased the four Slice 7 commits from `s7-integrate`
b6d3bdf75 onto main (first 04495d270, then a26efbcc9 once Slice H #2373 merged mid-round) and fixed what they
named. Every new test was run against the code it guards with that code reverted or mutated (bite table below).

**Rebase.** Conflicts: the master doc, the decision log and `tier-matrix.md` keep both sides' sections; the
binding-ledger `customer.portal` sources are the union, minus the old Agreements `20271110220000` path;
`PortalGateway.tsx` keeps Slice H's host-routing import and Slice 7's access read; the 29 incumbent pins took
main's side and were renewed against the composed bytes (note in `c0b-incumbent-resource-binding.mjs`).
Main's Agreements migration is byte-identical to the one Slice 7 restated from (`git mv` 220000 → 225000, 0
lines changed), Payments 230000 is byte-identical to b6d3bdf75's, and main's only new migration,
`20271110220000_followup_email_origin_admission`, defines `prepare_comms_email_send`,
`read_comms_email_send_binding`, `claim_comms_email_send`, `paige_guard_send_approval_requires_governed_send`,
`_lead_reply_record_send` and `advance_action` — none of which 240000 restates. Slice H changed no migration
or edge file. Every function 240000 restates, with its newest definition on main before 240000 and the
canonical body delta (lines added/removed by 240000, including round 3's replay keys):

| Function | Newest source on main | Delta |
|---|---|---|
| `client_portal_relationship_id` | 20271102120000 | +1/-0 |
| `get_client_rail` | 20261044000000 | +3/-5 |
| `get_client_rail_for_chat` | 20261044000000 | +2/-4 |
| `can_access_rail_topic` | 20260712250000 | +6/-7 |
| `get_client_service_agreement` | 20260710030000 | +1/-0 |
| `get_workspace_brand` | 20260630194059 | +1/-0 |
| `get_paige_persona_context` | 20261019000000 | +1/-0 |
| `is_program_client_owner` | 20260702184358 | +1/-1 |
| `load_self_context` | 20260702025123 | +1/-1 |
| `customer_paige_activity_summary` | 20260702025123 | +1/-1 |
| `can_access_contact` | 20271108201000 | +33/-1 |
| `client_portal_invite_status` | 20271108120000 | +5/-2 |
| `ensure_client_role_self_heal` | 20260701005309 | +1/-0 |
| `operations_delivery_client_read_scoped` | 20271110200000 | +1/-1 |
| `operations_delivery_client_reviews_scoped` | 20271031005020 | +2/-2 |
| `comms_portal_reply` | 20271110010000 | +4/-0 |
| `admin_propose_paige_actions` | 20260710070000 | +4/-2 |
| `notify_client_on_readiness_approval` | 20260702001451 | +1/-1 |
| `start_client_impersonation` | 20270519010000 | +9/-1 |
| `_create_client_with_contact_methods` | 20270519005000 | +2/-0 |
| `list_tool_autonomy` | 20271110060000 | +2/-2 |
| `client_portal_send_message` | 20271110010000 | +1/-0 |
| `client_portal_session_change_admit` | 20271110020000 | +2/-1 |
| `client_portal_update_self_profile` | 20271102130000 | +1/-0 |
| `client_portal_welcome_state` | 20271107110000 | +1/-1 |
| `client_portal_save_welcome` | 20271107110000 | +1/-1 |
| `client_portal_begin_file_upload` | 20271108150000 | +1/-1 |
| `client_portal_finish_file_upload` | 20271108150000 | +1/-1 |
| `client_advance_onboarding_stage` | 20271106120000 | +1/-0 |
| `paige_chat_thread_create` | 20271108201000 | +1/-1 |
| `client_portal_documents` | 20271110200000 | +1/-1 |
| `client_portal_can_upload_file_object` | 20271110200000 | +1/-1 |
| `client_portal_communication_preferences` | 20271110215000 | +1/-1 |
| `client_portal_set_communication_preference` | 20271110215000 | +5/-1 |
| `client_portal_set_shared_context_consent` | 20271110215000 | +5/-1 |
| `client_portal_agreements` | 20271110225000 | +1/-1 |
| `client_portal_open_agreement_signing` | 20271110225000 | +1/-1 |
| `client_portal_agreement_document_scope` | 20271110225000 | +1/-1 |
| `_client_portal_billing_client` | 20271110230000 | +1/-1 |
| `client_file_set_client_share` | 20271110200000 | +8/-4 |
| `client_file_owner_list` | 20271110200000 | +4/-1 |
| `plan_item_set_client_share` | 20271110030000 | +10/-4 |
| `read_client_communication_state` | 20271110215000 | +2/-0 |

Eleven functions are new in 240000 (`_clients_portal_access_guard`, `client_portal_access_open`,
`_client_portal_access_projection`, `_client_portal_access_authorize`, `read_client_portal_access`,
`set_client_portal_access`, `client_portal_access_state`, `_clients_link_caller_is_team`,
`_clients_portal_link_not_staff_guard`, `_client_portal_lock_relationship`, `_client_portal_access_word`).
No newest source moved between b6d3bdf75 and main, so round 2's body comparison carries forward unchanged.

**Fixes.**
- *Compliance A / security 4 — Files for {client} said "hasn’t joined your portal yet" right after a Restore.*
  `ClientFiles.tsx` no longer copies `portalConnected` into state once: paused/ended and joined come, newest first,
  from the latest share answer's `portal_access`, then the record's live props, then the list read (which may only
  add "joined"). A change in the props (Pause, Restore) drops what was heard before it. `useClientFilesOwner.ts`
  now keeps the share answer's `portal_access` (strict: `open | paused | ended | not_joined`, else null).
- *Compliance B — Invite again listed less than the new person sees.* Now: "Whoever accepts sees everything in this
  client’s portal — messages, shared work and files, sessions, invoices, agreements and their contact details — and
  can act on it. Their earlier invitations no longer work." (`ClientPortalAccess.tsx`, the reviewer's wording).
- *Security 1 — the pause/end confirmation said agreements stay as they are.* Both copies (`src/lib/client-portal-access.ts`
  card lines and `_shared/client-portal-access.ts` Paige's approval card) now add: "A signing link they opened from your
  portal stops working; resend it if they still need to sign." Restore says nothing about it.
- *Security 2 — a work-item share replay carried no access keys, and Paige read "no answer" as "can see".* The
  `plan_item_set_client_share` replay now answers `portal_connected` and `portal_access`; Paige's three share notes
  test `portalConnected !== true`, and `portalUnseenNote` says "Whether they can see it in their portal right now
  wasn't confirmed, so don't say they can." for a missing answer.
- *Security 3 — the revoke's scoping was untested.* Doors §11 adds the reviewer's probe (another client of the same
  business keeps its portal-issued link when Jordan is paused) and a portal-issued token on a signer who already
  signed (left as it is); both are checked again after End.
- *Security 5 — accepted residual (S7-D3, E09-S7-T3).* `agreement-send` writes the token (`agreement-send/index.ts:432`)
  and its `sent` event (`:445`) in two requests; a portal open between them leaves a portal link a later pause does not
  clear. Recorded, not fixed here: the smaller correct fix belongs in the Agreements engine (token and event in one
  transaction); a hash-identity revoke in Slice 7 would need a new audit payload and a fallback for earlier links.
  Window: one network round trip inside one send. Consequence: that signer keeps a link to sign the agreement just
  emailed, until least(agreement expiry, emailed-link expiry). Master §5 and the decision log carry it.
- *Low — the reach card kept saying "Joined" after a pause in the same session.* `ClientCommunicationState` takes the
  record's `accessState` and re-reads when it changes (wired at `TenantRelationshipsClientsWorkspace.tsx`).

**Bite table** (each mutation applied alone, the named suite run, the source restored).

| Mutation | Suite | Result |
|---|---|---|
| ClientFiles.tsx reverted to round 2 | ClientFiles.test | 3 fail (restore re-render, answer reads paused, answer reads ended) |
| useClientFilesOwner.ts reverted to round 2 | ClientFiles.test | 2 fail |
| prop change no longer drops the heard answer | ClientFiles.test | 1 fail (Pause then Restore outranks the answer) |
| the list overrides the props again (round-2 rule) | ClientFiles.test | 2 fail |
| the list can no longer add "joined" | ClientFiles.test | 1 fail |
| the answer's portal_access ignored for the confirmation | ClientFiles.test | 2 fail |
| the hook drops portal_access | ClientFiles.test | 3 fail |
| ClientPortalAccess.tsx reverted (old Invite again copy) | ClientPortalAccess.test | 1 fail |
| pause confirm without the signing-link line | client-portal-access.test | 1 fail |
| reach card ignores accessState | ClientCommunicationState.test | 1 fail |
| reach card not handed accessState | TenantRelationshipsClientsWorkspace.test | 1 fail |
| Paige's card without the signing-link line | Deno client-portal-access | 1 fail |
| `portalUnseenNote` silent on null | Deno client-portal-access | 1 fail |
| plan / file / re-file share guard back to `=== false` (each alone) | Deno client-portal-access | 1 fail each |
| replay without the access keys (240000) | doors | 3 fail (#110–#112) |
| revoke without `a.contact_id = v_row.id` (240000) | doors | 3 fail (#85, #87, #94) |
| revoke without `s.status IN ('pending','viewed')` (240000) | doors | 3 fail (#86, #87, #94) |

**Gates at the round-3 head (over a26efbcc9).** pgTAP: doors 113/113, access 214/214, delivery 29/0, every other portal
file equal to the base (counts in AUTOMATED_EVIDENCE). Vitest full suite: head 1041 files, 17664 tests, 0 failed;
base 1034 files, 17547 tests, 0 failed. Deno 53/53 and 48/48; edge ratchet over 22 functions clean. c0b 209/209,
sales-invoice-document 11/11. ci:tsc no new errors; baseline-guard ok; ESLint 0 errors; Impeccable 0 anti-patterns on
the changed UI; lints as in STATIC_EVIDENCE. Harness 152/152 frames.

**UNVERIFIED (unchanged).** Hosted CI, the production migration apply, the edge readback, authenticated owner and
customer runs, a two-session race (simulated in one session), and the agreement-send window (S7-D3) is reasoned
from the code, not driven.

## §58 call-outs (owner sign-off asked; the safe default ships if unanswered, D10)

- **The contact panel's access switch no longer deletes the person's login.** `ContactPortalPanel` (mounted on the non-Solo Portal view, the admin contact detail and the Conversations contact card) used to call `admin-delete-user` with `keep_contact:true` when switched off for a joined client. That function unlinked the person from every business, deleted their Paige account data, their private Cura threads and their Auth user. The switch now opens the reversible Pause (round 2); Pause and End are their own buttons, both through `set_client_portal_access` with a reason, and a paused client's switch or Restore button restores access. Deleting a person's account entirely stays available only through the admin account tools (`ContactsAdmin` "also delete platform account", `ClientManagementDashboard`, `MembersRolesPanel`), which this slice does not change; their global-admin authorization is filed separately (plan §7).
- **The record's static "Portal access · PARTIAL" placeholder** now points at the Portal access card on the Solo record (the non-Solo text is unchanged).
- Nothing else previously shipped is removed. The owner Portal dashboard gains "Access paused" (also in its attention list) and "Access ended" states and filters.

## Known limits

- Sub-account and Enterprise businesses pause, restore and end from the contact panel (round 2 added Pause there); they have no Solo record card (same §60 gap as `client_standing`).
- The QA relationship must be ended by 2026-10-30 by that business's owner after merge (D11); CC does not press it. Checked 2026-10-18 on production (SELECT-only, counts only): its tenant has 1 active owner/admin and the platform `super_admin` is not one of them, so that business's own admin presses it; an operator acting inside the workspace is not built or proven for this card.
- The roster, the inbox thread join and the contact panel read the new `portal_access_*` columns. Round 2: if the frontend deploys before migration `20271110240000` is applied, each re-reads without them (42703) and every client reads open, as before this slice; the migration should still apply first.
- Exposures a pause or end does not close (`detect-credit-alerts` push/email on the funding opt-in, notifications delivered before a pause, an already-open realtime channel) are logged in master §5.
- Residuals in this slice's own gates (round 3, also in master §5): **open** — `booking-manage` admits and writes in two transactions, so a pause landing between them can let one reschedule or cancel through; **open, owner §58 decision** — staff can still self-link through email change → invite → accept (the direct-write guard covers business members, members of a business above it, agency team-list staff and the platform operator since round 3); **fixed in round 3** — a stale Chat approval: the card is bound to `access_version`, so a change after the card was built is refused with nothing written.
