# UI delivery evidence: EXP03 governed email attachments — the approval card shows the files the approved email carries

Branch `claude/great-heisenberg-u7kyd9`, commits d4be0c1d (feature) and 883888b5 (review round), merged with origin/main at a14462e5. Visible change: `src/components/chat/PaigeConfirmCard.tsx`. Under the Subject, the email approval card gains a **File / Files** row. It lists each file the approved email carries by the name the person gave it and a plain-language size (`formatFileSize`: "820 bytes", "48 KB", "2.4 MB"). Each line has a paperclip hidden from assistive tech, and the list's accessible name is "1 file attached" / "N files attached". Supporting UI-side changes:
- `confirmPreview.ts` parses `preview.attachments`. Only a well-formed list of 1–10 named files passes; anything else is dropped and the summary sentence still names the files.
- `governedSend.ts` gains `governedAttachmentRequest`. Nothing calls it yet.

The backend declares `Visible-Flow-Impact: yes`: migration 20271120000000, comms-email-command, send-message, comms-scheduled-drain, and the shared comms-email attachments/contract/adapter/readiness and channel-adapters bundles.

§13: no product surface sends files on a governed email yet. The composer is piece 3, and the chat never attaches files to an email. So today the File row appears only when the door is handed an `attachments` request directly. The frames below render it from the exact preview shape comms-email-command writes (`commsEmailAttachmentPreview`: `{ name, size, mime }`).

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow trace in this record and the branch's commits — actor = the business owner (Solo/Sub-account) approving an email PAIGE drafted in the PAIGE chat; goal = see exactly which files go with the email before approving; central act = Approve; states = no files (unchanged card), one file, several, the maximum ten, a malformed list (dropped, the summary still names the files); exits unchanged (Approve, Not now)
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design/SKILL.md read; .agents/skills/impeccable/reference/craft-floor.md read before judging the frames; the row reuses the card's own dt/dd envelope row (same label and value classes as To/From/Subject), the paperclip is the chat's existing lucide icon in muted ink, sizes use tabular numerals; craft findings below
MATERIAL_FLOW_CHANGE: YES: the approval decision now carries new information a person must read before approving (which files, how large); the Approve/Not now acts and their consequences are otherwise unchanged
FLOW_PROTOTYPE: PASS: the owner-approved "Reply Check Prototype" artifact (https://claude.ai/artifact/1Nuv5dV892no1q9dMxSUte; owner decision 2026-10-27 "B with (ii)", whose (ii) shows the files in the check) plus the real-component harness frames in docs/evidence/ui-delivery/assets/exp03-governed-attachments/ (exp03a-*.jpg); the owner has not yet seen these harness frames — under the CLAUDE.md §4/§69 pre-launch override they travel with the PR and he reviews the live surface after merge
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience = the business owner approving an email PAIGE prepared; primary action = Approve or Not now; purpose = the files are part of what is approved, so the card names each one and its size before the act
VISUAL_DIRECTION: PASS: no new visual language — the envelope's existing label/value row, foreground ink for names, muted-foreground for sizes and the paperclip, tabular-nums; tokens only (0 hex/rgb literals added in src); no gold in the row (measured); gold stays on Approve; light and dark both rendered
AUTOMATED_EVIDENCE: PASS: npx vitest run src/components/chat/PaigeConfirmCard.preview.test.tsx src/components/chat/confirmPreview.test.ts src/__tests__/comms-email-attachments.test.ts src/__tests__/comms-email-command.test.ts src/solo/__render__/confirm-email-preview.render.test.tsx → 5 files, 129 passed, 1 skipped (this session, at a14462e5); harness drive scripts/live-drive/harness/exp03-governed-attachments-mount/drive.mjs → exit 0, 18/18 frames OK (exp03a-measurements.json); the Deno tests (adapter, scheduled-drain, send-message door) and the SQL proof supabase/tests/comms_email_governed_attachments.sql were not run in this session — CI on the PR carries them
STATIC_EVIDENCE: PASS: contract inspection at a14462e5 — comms-email-command writes preview.attachments from commsEmailAttachmentPreview (name, size, mime only; never the storage path) and the summary sentence adds " — with N files: a, b, c" (commsEmailAttachmentSummary); parseConfirmPreview accepts 1..10 files with a non-empty name ≤120 chars, a mime ≤255 chars and an integer size ≥1, else drops the list; lint/typecheck/build are left to the PR's CI (not re-run here)
RENDERED_EVIDENCE: PASS: 18 harness frames of the REAL Solo PAIGE chat (PaigeAIChat with soloTenantSafety) answering with the real PaigeConfirmCard, inside the shell's real .tcs-paige column at max(340px, 26vw) (≈355px at 1366) and full width at 390x844, prefers-reduced-motion reduce, Schibsted Grotesk loaded in every frame, in docs/evidence/ui-delivery/assets/exp03-governed-attachments/: files 0 (control), 1, 3 (one 95-character name) and 10 × light/dark × 1366x768 dock and 390x844 (exp03a-files{0,1,3,10}-{light,dark}-{1366x768,390x844}.jpg), the 3-file card at 1536x770 (≈400px dock), and for 3 and 10 files a second dock frame scrolled to Approve (exp03a-files{3,10}-*-approve.jpg); measured AA, light/dark: file name 13.12/14.56 (13px, foreground), size 4.78/6.82 (13px, muted), "File(s)" label 4.78/6.82 — all ≥4.5:1; no row, card, transcript or page overflow in any frame; 0 gold paints in the row; the label "harness render · not live" is burned in after measurement and checked topmost
BEHAVIORAL_EVIDENCE: PASS: the drive sends a message as a person would (fill + Enter); the scripted answer carries the exact confirm frame; the browser's own parser admits the list and the card renders exactly N items with "File"/"Files" and "1 file attached"/"N files attached"; with no files the row is absent and the card is the existing one; every size reads in plain units (820 bytes … 7.5 MB); no storage path is on screen; Approve stays reachable (by scrolling in the dock for 3+ files, and by Tab — see KEYBOARD_FOCUS); NOT exercised: Approve itself (it sends nothing here), a malformed list (covered by confirmPreview.test.ts), and the server reading, fingerprinting and sending the bytes
AUTHENTICATED_RUNTIME: UNVERIFIED: no product surface sends files on a governed email yet (the composer is piece 3; the chat never attaches files to an email), so no signed-in drive of a card carrying files is possible from the product, and no real SendGrid send with attachments has been made; owed to a §32.c session once the composer slice can stage files on a governed email
KEYBOARD_FOCUS: PASS: in the 1366 dock, light and dark, Tab from the page reaches Approve in 8 stops with 0, 1, 3 and 10 files alike — the row adds no tab stop (it is static text, correctly); the accessibility tree reads term "Files", definition → list "3 files attached" → three listitems "<name> <size>", with no image node for the paperclip (aria-hidden="true")
ZOOM_REFLOW: PASS: names wrap inside the row and never overflow at 355px, 400px and 390px; at the 355px dock names break at their own seams (a 95-character name over 9 lines); browser 200%/400% zoom was not exercised
REDUCED_MOTION: PASS: no motion added; every frame rendered with prefers-reduced-motion: reduce
STATE_COVERAGE: PASS: no files (row absent, card unchanged), one file ("File", "1 file attached"), three including a 95-character name, ten (the maximum); a malformed list is dropped (unit test, not rendered); the card's working/done/failed/unconfirmed states are unchanged and not re-rendered here
TRUTHFUL_STATE_LABELS: PASS: the row lists exactly the files the server read and fingerprinted for this approval (the preview is built from the same manifest the fingerprint covers), by the name the person gave each file and its real size; it never shows a storage path; a malformed list shows no row rather than a partial one, and the server's summary sentence still names the files
SOLO_UI: YES: the Solo PAIGE chat approval card (SoloPaigeWorkspace → PaigeAIChat with soloTenantSafety → PaigeConfirmCard), in the docked PAIGE column and on the Solo PAIGE page; no account-specific path
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: the card lives only in the PAIGE chat; the Solo PAIGE page (full workspace) at this viewport was not rendered — the harness mounts the chat in the dock or at phone width only
SOLO_1536X770_PAIGE_OPEN: PASS: exp03a-files3-{light,dark}-1536x770.jpg (+ -approve) — the 3-file card in the ≈400px dock; the long name wraps over 10 lines without overflow; contrast as above (SoloPaigeWorkspace's tab strip/chat head are not mounted, a harness divergence)
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: same as 1536 closed — the Solo PAIGE page was not rendered at this viewport
SOLO_1366X768_PAIGE_OPEN: PASS: exp03a-files{0,1,3,10}-{light,dark}-1366x768.jpg (+ -approve for 3 and 10) — the card in the ≈355px dock; no overflow; the narrow column makes names break mid-word (finding 1)
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: not rendered at this viewport
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: not rendered; at ≤1080 the PAIGE panel is the shell's overlay, not the dock this harness reproduces
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: not rendered at this viewport
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: not rendered; the overlay layout at this width is owed to an authenticated Solo drive
UNVERIFIED: authenticated runtime (above); the Solo PAIGE page and the 1024/900 overlay layouts (not rendered); the SoloPaigeWorkspace wrapper around the docked chat (not mounted); Approve with files and the server's byte read, fingerprint, copy and SendGrid send (proven by Deno/SQL tests in CI, not observed live); a card rehydrated from a saved turn with files (the same parser gates it; not rendered here); browser zoom

OWNER_INTENT: the owner (Antonio) chose, on 2026-10-27 in the Reply Check Prototype ("B with (ii)"), that an approved email can carry files and that the check shows them: target actor = the business owner approving an email PAIGE drafted; user job = see which files go with it and approve once; required outcome = exactly the files shown, with the bytes that were approved, go out with that email through the business's governed sender, and nothing else
MUST_NOT_HAPPEN: bytes sent that differ from the bytes approved (a file changed after approval goes nowhere); another business's file read, listed or attached; a file sent through Gmail/SMTP or any path other than the governed SendGrid door; a storage path or internal code shown on the card; a file added to an email the owner approved without it; an approved email without files changing shape, fingerprint or summary
MUST_PRESERVE: the email card without files exactly as it was (golden fingerprint test: unchanged keys and fingerprint); To/From/Subject/body, the eight-line body clamp and "Show full email"; Approve/Not now and the card's focus rules; scheduled sends (send_at) and their summary; every non-email approval card
ACCEPTANCE_CRITERIA: an approval card for an email with files lists every file by name and size under the subject, says "File" or "Files", is announced as "N files attached", shows no path, and adds no tab stop; an email without files shows the card exactly as before; Approve stays reachable with ten files on a phone and in the dock
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: the comms_send_email confirm fingerprint and summary without files (golden test in comms-email-command.test.ts, this session); parseConfirmPreview for previews without attachments (confirmPreview.test.ts, this session); PaigeConfirmCard email preview rendering (PaigeConfirmCard.preview.test.tsx and the solo confirm-email-preview render test, this session); send-message's governed door and the scheduled drain carrying the governed files (send-message-sendgrid-door.test.ts, scheduled-drain.test.ts in CI); the migration's storage/tenant scoping (SQL proof in CI); unaffected and named: the inbox (governedAttachmentRequest has no caller), non-email approval cards, the composer
<!-- RELEASE_GOVERNANCE_POLICY — read docs/doctrine/release-governance-and-customer-update-policy.md -->
INTERNAL_BUILD_IDENTITY: d64ac28a6f08010bc69a287be6e0a0902f84fedc; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20271120000000_comms_email_governed_attachments applies on merge via deploy-migrations and its schema_migrations readback follows); edge=PROOF_OWED(comms-email-command, send-message and comms-scheduled-drain, with the shared comms-email and channel-adapters bundles, deploy on merge via deploy-edge-functions); evidence=docs/evidence/ui-delivery/assets/exp03-governed-attachments/exp03a-measurements.json and the commands in this record (frames rendered from the tree at a14462e5); the all-zero SHA is stamped by the integrator with the exact head commit
RELEASE_CHANNEL: development: code on branch claude/great-heisenberg-u7kyd9; the migration, the edge functions and the frontend deploy to production on merge (pre-launch §4 stance, no staged rollout)
RELEASE_CLASSIFICATION: internal-only: the door, the storage and the card's File row ship, but no product surface can stage files on a governed email until the composer slice lands, so no customer can reach the capability yet
CUSTOMER_RELEASE_IDENTITY: none: not reachable by customers until the composer slice ships; the owner decides a customer release then
RELEASE_NOTE_REQUIRED: NO: nothing a customer can do changes until the composer slice; the note belongs to that release
RELEASE_TRUTH_BOUNDARY: PARTIAL: the card's File row is LIVE on the frontend after merge for any confirm frame that carries files; attaching files from the product is UNAVAILABLE (piece 3); the migration's persisted apply and a real send with attachments are PROOF OWED until observed on prod (schema_migrations reads back 20271120000000; a governed email with files is delivered with the approved bytes)
RELEASE_RECOVERY: position=forward-fix preferred — the card change is a self-contained revert of two UI files, while the migration adds storage and functions behind its own guards and is reverted only by a new migration; reference=supabase/migrations/20271120000000_comms_email_governed_attachments.sql header, branch commits d4be0c1d..883888b5

## Scope and collisions

- Classification: UI change (`PaigeConfirmCard.tsx`, `confirmPreview.ts`; `governedSend.ts` adds an uncalled helper) plus a backend change (migration, three edge functions, shared bundles) with a declared visible-flow impact.
- Affected flow: approving an email PAIGE drafted, in the PAIGE chat, when the email carries files.
- Neighbouring regressions checked: the same card without files (control frames exp03a-files0-*, identical structure, no File row); the golden no-files fingerprint test.
- Active-owner/file collisions: another session edits `docs/delivery/`, `docs/brain/`, `docs/doctrine/` and the master reference; this record touches none of them and no source file.
- Explicit exclusions: the composer staging files (piece 3); the inbox showing a sent email's governed files.

## User job and state map

The owner reads the card PAIGE raised and decides. The scroll owner is the chat transcript. The card has these states:

- **No files:** the card is unchanged.
- **One file:** "File", one line with the name and size.
- **Several files (up to ten):** "Files", one line per file, and the list is announced with its count.
- **Malformed list:** no row; the summary sentence still names the files.

Approve and Not now behave as before.

## Evidence index

- Harness: `scripts/live-drive/harness/exp03-governed-attachments-mount/` (`vite.config.ts`, `main.tsx`, `index.html`, `stubs.ts`, `drive.mjs`). It is copied from `paige-chat-mount`'s Solo chat mount, using the real shell `.tcs-paige` / `.tcs-paige-body` classes, and serves the repo's local Schibsted files. Only the data hooks are stubbed. The SSE answer carries the confirm frame in comms-email-command's shape. Run: `PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome node scripts/live-drive/harness/exp03-governed-attachments-mount/drive.mjs` (starts its own `vite --host 127.0.0.1 --port 5197`). Exit 0; 18/18 frames OK.
- Frames and measurements: `docs/evidence/ui-delivery/assets/exp03-governed-attachments/`. It holds 18 frames, 6 Approve-scrolled dock frames (3 files at 1366 and 1536, 10 files at 1366, both themes) and `exp03a-measurements.json`, about 0.8 MB.
- Tests: the vitest run under AUTOMATED_EVIDENCE.
- Data: all synthetic and fictional (Brightwater Advisory, Maya Ortiz, Ortiz Landscaping). No secrets or customer data.

## Review and limitations

**Impeccable craft findings (judged against `reference/craft-floor.md`, §11, §23), ranked.**

Fixed in this PR after the first capture, then re-driven (all 18 frames OK):
- **Was MEDIUM — file names broke mid-word into tall ribbons in the docked chat.** Each size now sits under its name, so the name gets the whole value column, and names break only after `-`, `_`, `.` or a space (`<wbr>`; `overflow-wrap:break-word` only as a last resort). Measured: "Spring-planting-proposal.pdf" 5 → 2 lines; the 95-character name 17 → 9 lines at the 355px dock (6 at 400px, 4 at 390 full width); ten ordinary names are 1–2 lines each.
- **Was an observation — no total size.** More than one file now shows "<size> in all".

Still open:
1. **MEDIUM (pre-existing, outside this diff) — the email card is narrow in the docked chat.** Its full-width step-out is keyed to the viewport (`max-[479px]`), not to the panel, so in the 355px dock the whole card (the email body too, about 20 characters a line in the control frame) sits in a narrow column. Already noted in `comms-email-send.md`; fix by keying the layout to the panel's own width.
2. **LOW — size contrast is just above AA in light.** Size and the "Files" label measure 4.78:1 at 13px (muted-foreground on the card), which passes. Dark is 6.82:1.
3. **LOW — no way to tell file types apart at a glance.** Every line carries the same paperclip whatever the file. The name's extension carries the type, which is enough; a per-type icon would be decoration, so this is noted only.

What passed:
- Tokens only, with 0 colour literals added.
- No gold in the row; gold stays on Approve.
- Names in foreground ink and sizes in muted ink, AA in both themes.
- Tabular numerals; plain-language units.
- No storage path or code on screen.
- The list is announced with its count, and the paperclip is hidden from assistive tech.
- No new tab stop.
- Light and dark are clearly distinct.

**Limits of this harness.** It proves the real chat and card render the server's preview shape and that the browser's parser admits it. It does not prove:
- the signed-in Solo chat, or Approve sending the approved bytes;
- the SoloPaigeWorkspace wrapper (not mounted);
- the overlay layouts at ≤1080.

The local Schibsted files render punctuation with a gap before it ("Maya ,", "2 .4 MB"), the same artefact earlier harness frames show. It is not attributed to this change.
