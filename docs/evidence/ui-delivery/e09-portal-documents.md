# Customer Portal — Documents (E09 Slice 4)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: actor-goal flows mapped before edit (slice4-plan §0–§3, re-verified against main dbb8a8842) — owner adds a file for a client and it stays private, owner shares and unshares one file, owner opens a file and sees what the client sent, client opens a file the business shared, client uploads back, client reviews released work and accepts or asks for changes, owner prepares, reviews and releases work for a client; first use (no files), unfinished upload, uncertain upload, stale version, client not yet joined, refused, unavailable, multiple businesses, signed-link failure, one-member team and actor-change states included.
PAIGE_UI_DESIGN: PASS: Impeccable detector run on every changed .tsx/.css (0 anti-patterns; 4 advisory font-size notes are on pre-existing lines of operations-workspace.css); every frame was rendered and looked at; two design changes came from looking — Open became a quiet text action so the share switch stays the row's one decision, and the docked record pane (426px) now stacks a row's actions under the file below 480px. Single author critique, not Impeccable's two-assessment critique.
MATERIAL_FLOW_CHANGE: YES: owners gain "Files for {client}" on the Solo client record and the client release flow in the Operations work item; customers' /app/documents gains signed-link open/download and "Work for your review"; the customer Home Documents tile now counts their Documents and opens /app/documents.
FLOW_PROTOTYPE: WAIVED: owner-decision=CLAUDE.md §4 pre-launch override 2026-09-05 and the owner's E09 portal decision 2026-10-17 (the customer sees only what the business shares), with Slice 4 defaults D1–D8 ruled to ship as written; reason=no live customers and the owner fixed the flow; the owner reviews the live surfaces after merge.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a business owner keeps a client's files in one place and chooses, file by file, what the client sees; the client opens what was shared, sends documents back, and accepts or asks for changes to finished work.
VISUAL_DIRECTION: PASS: owner side in the Solo record's pg tokens as a sibling of "Shared with {client}" (same Switch, hairlines, 44px labels, no card grid, no gold); customer side on the incumbent portal tokens and shadcn primitives with the business accent on the one primary button; the reused review keeps its own approve-moment gold. No new palette, typeface or shell.
AUTOMATED_EVIDENCE: PASS: Vitest — the slice's 11 changed or new test files: 242 of 244 pass in a parallel run, and the 2 that failed (the workspace "narrow list inert" focus test and the three-step editor test) are timing flakes under load — both also failed on base dbb8a8842 under the same load and both pass when rerun at low concurrency; fail-first, the same 11 files against base source fail 11 of 11 files (39 tests); whole suite base vs branch measured in separate git worktrees (Baselines section); 10 frontend mutants each caught by a named test (list below). pgTAP supabase/tests/customer_portal_documents.sql (148) is the backend lane's (commit eef83fc53) and is registered in paige-spine-contract.
STATIC_EVIDENCE: PASS: tsc ratchet passes (baseline 10, current 7 — no new signatures); ESLint clean on every changed src file (0 errors, 0 warnings); lint:tier-features, lint:solo-parity, lint:skeleton, lint:legacy-mark, lint:user-facing-admin-urls, lint:pg-tokens, lint:shadow-vars, lint:tool-catalogue, lint:write-targets, lint:alias-ratchet, lint:approval-direct-write, lint:receipt-coverage, lint:action-authority, lint:governed-execution, lint:capability-declaration, lint:conversation-tenant, lint:release-governance, lint:migration-versions, lint:definer-fns, lint:views, lint:chat-tool-registry, lint:action-risk, the binding-ledger lint and the Spine registry lint pass; lint:gold fails on BusinessCreditDashboard.tsx:271, identically on base dbb8a8842 (pre-existing, not touched). npm run build succeeds and every slice string is in dist (owner section and release state in the Solo chunk, customer section and tile in the portal chunk).
RENDERED_EVIDENCE: PASS: harness renders with the real components, real CSS and synthetic data, network blocked (scripts/live-drive/harness/owner-client-files and portal-documents-customer-mount). Owner: 50 frames (16 states, light and dark, 1440x900 and 390x844) pass measured AA contrast (lowest 5.9 light, 6.85 dark), no overflow, clipping or spill, no gold, 44px phone targets, nothing the owner list must not return. Customer: 60 frames (15 states including the review dialog, accept, request changes, image preview, signed-link failure and the Home tile) pass (lowest 5.2 light, 7.27 dark), no gold except the review's own "Accept this version" act, 44px phone targets, nothing private, unfinished, other-client or other-business visible. The shared customer nav's gold active item and Client pill are pre-existing chrome findings, reported and not graded. Self-tests: 7 owner and 6 customer injected defects (gold, contrast, overflow, target, clip, success-without-re-read, public upload, label) were each caught.
BEHAVIORAL_EVIDENCE: PASS: component and hook tests drive share and unshare with the row version, success only after a fresh list read, FILE_CHANGED re-read, the client's uploads having no switch, private-by-default upload (no visibility argument), uncertain upload checked with the same id, Open with a 60-second link, every refusal state; the customer list through the RPC with exact-key refusals, signed view and download links, no signing of an unlisted path, link expiry and fresh link, labels, image-only preview; released work scoped from the self profile with no clients read, the 40-row limit and partial counts, hidden where releases are not offered, actor-change invalidation, accept and request changes through the decide RPC, the close guard; the release flow mounting only for standalone businesses with client work in a project, and the one-member copy.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated owner upload/share/open, customer read/open/upload or release decision was driven on production; owed after merge with a seeded test tenant, a linked test customer, a second team member and a Studio text version.
KEYBOARD_FOCUS: PASS: share switches sit in 44px labels with indigo focus rings; Open, Add a file, Finish upload and Check saved upload are buttons; the review dialog returns focus to its Review button and refuses to close over an unsaved note. Physical assistive technology untested.
ZOOM_REFLOW: PASS: 390px frames reflow without horizontal overflow; the docked record pane stacks row actions below 480px; browser 400% zoom not exercised.
REDUCED_MOTION: PASS: the owner section's fade and skeleton pulse sit behind prefers-reduced-motion, switches drop their transition under reduce, and the dialogs carry motion-reduce:!animate-none.
STATE_COVERAGE: PASS: owner — loading, empty with Add a file, populated in three sections, not joined, joined, share pending, confirmed (joined and not), unshare, FILE_CHANGED, uploading, uncertain, saved, opened, refused, unavailable (agency), inactive client, error; customer — loading, empty, shared plus own uploads, upload incomplete, work awaiting review, review dialog, accepted, changes requested, release read failed, unavailable, multiple businesses, signed-link failure, image preview, Home tile.
TRUTHFUL_STATE_LABELS: PASS: a share or an upload is reported only after a fresh read shows it; a client who has not joined is told so; a failed read is never shown as zero or as an empty list; a lapsed link says so.
SOLO_UI: YES: "Files for {client}" lives on the shared Solo client record behind the existing client_standing gate; the release flow lives in Solo Operations for standalone businesses; no account-specific path.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: the owner harness was rendered at 1440x900 and 390x844 only; owed to an authenticated Solo drive.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: the owner harness mounts the record without the PAIGE dock; owed to an authenticated Solo drive with PAIGE open.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: not rendered at this width; owed to an authenticated Solo drive.
UNVERIFIED: authenticated owner upload/share/open, customer read/open/upload and release decision on production; the Operations release flow rendered in a harness (component tests only); the record at 1536, 1366, 1024 and 900 widths and with PAIGE open; real Storage signed URLs and Content-Disposition; screen reader; browser 400% zoom.

OWNER_INTENT: The customer sees only what the business explicitly shares. A business keeps a client's files on the client record, shares them one at a time, and can release finished work for the client to accept.
MUST_NOT_HAPPEN: No private, unfinished, other-client or other-business file reaches a client; no description, sharer or staff user id reaches a client; no file starts shared; no share applied from a stale view; no share reported before a fresh read confirms it; released work is never read through the CRM clients table; a customer cannot delete or rename anything.
MUST_PRESERVE: The customer's upload pipeline (begin, Storage upload, finish, status, Check saved upload) byte-for-byte; Slice 3's "Shared with {client}" and ClientStanding; the Home tiles' other behaviour; Operations work editing and activity.
ACCEPTANCE_CRITERIA: An owner adds a PDF for Jordan Rivera, sees it private, shares it, and Jordan opens it from /app/documents; Jordan uploads a document and the owner sees it under "From Jordan"; an owner with a second team member releases a text version and Jordan accepts it on /app/documents.
MOTION_PURPOSE: NONE: no new motion beyond the sibling section's fade.
PROTECTED_SEAMS: client_file_owner_list, client_file_owner_begin_upload, client_file_owner_finish_upload, client_file_set_client_share and client_portal_documents are SECURITY DEFINER with in-body scope (§59); signed links are minted only for a path the closed read returned and Storage re-checks the row; the delivery decide RPC owns acceptance.

INTERNAL_BUILD_IDENTITY: d26774c084f1880d913ba999a9495b39d4ab375c; deployment=NOT_DEPLOYED; environment=local; migrations=PROOF_OWED(20271110070000 persisted apply on production after merge); edge=PROOF_OWED(paige-ai-chat deploy readback after merge); evidence=docs/evidence/ui-delivery/e09-portal-documents.md
RELEASE_CHANNEL: development: branch slice4-documents; production deployment, migration persisted-apply and edge readback are verified after merge.
RELEASE_CLASSIFICATION: internal-only: fourth slice of the Customer Portal; no customer release until all seven pillars and authenticated proof exist.
CUSTOMER_RELEASE_IDENTITY: none: pre-launch; no customer release named until the seven pillars and authenticated proof exist.
RELEASE_NOTE_REQUIRED: NO: pre-launch internal increment.
RELEASE_TRUTH_BOUNDARY: PARTIAL: local automated, build and harness-rendered proof; authenticated runtime proof owed.
RELEASE_RECOVERY: position=forward-fix — the frontend adds sections and reads with no data migration of its own, and the migration is additive (two nullable columns, a trigger, an index, five RPCs and a restated read) plus two narrowed policies; reference=supabase/migrations/20271110070000_e09_customer_portal_documents.sql

## Baselines (whole Vitest suite, base vs branch, separate git worktrees, never git stash)

The machine was shared with other crews' runs (load average 24–41 on 4 cores), so timing-sensitive tests flaked on both sides.

| Run | Files | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| base `dbb8a8842` (worktree) | 3,009 | 16,044 | 15,820 | 216 | 8 |
| branch `d26774c08` (this worktree) | 3,017 | 16,122 | 15,869 | 250 | 3 |

81 failures appeared only on the branch, in 19 files (mostly PaigeAIChat composer/stream, Operator intelligence and Mission targets — none touched by this slice except the clients workspace test); 48 appeared only on base. Rerunning those 19 files on the branch at `--maxWorkers=2`: 535 passed, 0 failed. No failure is attributable to this slice.

## Frontend mutants (each reinstated, the named test failed, then restored)

1. Released work reads the `clients` table → useClientPortalReleasedWork and ClientReleasedWork tests fail (12).
2. Owner share success before the re-read → ClientFiles "reports success only after a fresh read" fails (2).
3. Customer list back on a direct `client_files` read → useClientDocuments "never the file table" fails (16).
4. Owner upload starts shared → ClientFiles "adds a file privately" fails (1).
5. Customer list accepts an extra key → validator and hook refusals fail (3).
6. Released work shown where releases are not offered → hook and component "hidden" tests fail (2).
7. Release flow mounted for a non-standalone business → OperationsWorkspace mount test fails (1).
8. One-member team gets the reviewer picker → OperationsItemRelease "second reviewer" fails (1).
9. Signed link without the 60-second expiry and download name → useClientDocuments signed-link test fails (1).
10. Home tile counts the legacy `documents` table → ClientHomeTiles "never counts the legacy documents table" fails (1).

## §58 call-outs

- The customer list no longer shows a `client_upload` row uploaded by a different login of the same client (the old "Customer upload" label); the server read returns only the caller's own uploads (plan 1e). Production has 0 `client_files` rows.
- The customer Home Documents tile no longer counts the legacy `documents` table (0 production rows) and no longer opens `/app/business`; it opens `/app/documents`.
- The customer preview no longer builds a Blob URL; it uses one-minute signed links.
- The static "Client files · PARTIAL" record card and the Portal "Files and agreements" card text change to point at the live section.
- The unreachable admin `ContactFilesPanel` upload stops working (backend fold-in 1g.2, D5); the panel is not deleted.

## Known limits

- Sub-account and Enterprise businesses can upload and share through the server but have no screen (§60 gap, same as Slice 3).
- Releases need a second active team member and a standalone business (D2/D3); file artifacts cannot be released.
- No owner delete or rename (D7); the customer cannot delete or rename (D8).
- The customer list pages by `created_at`; two files with the identical timestamp at a page boundary could be skipped by "Load more".
