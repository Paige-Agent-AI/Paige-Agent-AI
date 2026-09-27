# UI delivery evidence: a credit-report sync that did not complete reads as a sentence

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Quick depth inside one flow — a client uploads a credit report in the portal chat (/app) and the sync does not complete; the pre-edit packet (actor, the failure state, the one server emit and the one panel line that change, the neighbours left alone) is in the PR body, and the other sync_status frames (awaiting review, nothing to propose, client scope refused) were inspected and are unchanged.
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design/SKILL.md read for R3 in this session and its read-first files earlier; Impeccable's craft floor re-read immediately before the panel edit (its copy rule: errors name the problem and the recovery); `impeccable detect --json src/components/chat/SyncStatusPanel.tsx` returns [].
MATERIAL_FLOW_CHANGE: NO: a presentation-only change to one state's words — the failed sync is still a failed sync, drawn with the same failure treatment, with the same exits; only the sentence the uploader reads changes (from the pipeline's own text and step name to a sentence saying what happened and what they can do).
FLOW_PROTOTYPE: NOT_REQUIRED: the paige-ui-design skill's clause for a presentation-only adjustment that changes no action, state, exit or consequence; the rendered before and after below show the result.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a business's client who uploaded a credit report in the portal reads, when its details could not be pulled out for them to review, what happened and what they can do next — and that nothing was added only when nothing could have been — never an exception message, an internal field name or a pipeline step.
VISUAL_DIRECTION: PASS: the incumbent panel, unchanged — its failure container, the "Sync Incomplete" header and its list; only the message line changes, and it loses the "Error:" label now that it is a sentence.
AUTOMATED_EVIDENCE: PASS: `test:client-memory-authz` 423/0 on the real paige-ai-chat handler: 30.33 drives a client's credit report whose extraction fails its parse and asserts the frame carries the nothing-added sentence, no step and none of the pipeline's text, and that no memory note or upload stamp was written (before this change the same drive's frame was `{"success":false,"error":"Failed to parse extracted data","step":"extraction_parse"}`); 30.34 (control) gives the extraction a readable report and it reaches the proposal after a client memory note is written; 30.35 refuses that report's upload stamp, after the note, and asserts the did-not-finish sentence, no step, no write label, and the step in the server log; 30.36 has validation refuse the report and asserts the nothing-added sentence and that nothing was written. `test:client-seat-reply` 18/18 (every step on its side of the first write, a step nobody has named, each field only in its own type, a raw error never passed); `SyncStatusPanel.awaitingReview.test.tsx` 6/6 (the failure treatment kept; a step from an older server never drawn). 16 of 17 mutations turn a suite red (the server emitting the raw result, a raw error passed, fields outside the panel's passed, counts, flags and scores untyped, every step or no step saying nothing was added, a rejected write or an exception counted as before any write, a memory note written before the parse or the validation return, success from a truthy value, a report waiting on review given a failure sentence, the log line dropped, the panel drawing the step); the survivor is the handler's outer catch, which no harness reaches, and is correct by reading.
STATIC_EVIDENCE: PASS: ESLint exit 0 on the changed files; `impeccable detect` [] on the panel; `ci:regression` exit 0 against the base; `ci:tsc` 12 → 12.
RENDERED_EVIDENCE: PASS: docs/evidence/ui-delivery/credit-sync-message/ — the real PaigeChat and SyncStatusPanel in Chromium on scripts/live-drive/harness/paige-chat-mount (AppShell's /app frame): before-1366x768-light.png rendered from a checkout of the base commit (the old panel reading the pipeline's frame: "Error: Failed to parse extracted data (step: extraction_parse)"); after-* (a sync stopped before its first write) at 1536x770 light, 1366x768 light and dark, 1024x768 light and 390x844 light and dark; partial-* (a sync stopped after it) at 1366x768 light and 390x844 light and dark; after-zoom200-1366x768.png; stale-server-1366x768-light.png (the new panel given an old server's frame draws no step). A structural harness render of the shipped components, not an authenticated capture.
BEHAVIORAL_EVIDENCE: PASS: scripts/live-drive/paige-chat-sync-render.mjs, 11/11 (credit-sync-message/drive-results.json) plus the base commit's before render, 1/1 (before-results.json): a document sent, the answer and the panel arriving over a two-chunk stream, the panel measured with the right sentence present, no step or pipeline text, nothing clipped and nothing scrolling sideways at every width and theme and at 200% zoom.
AUTHENTICATED_RUNTIME: UNVERIFIED: this lane holds no client-portal session; a failed sync cannot be provoked on demand in production, so its live proof is a `[paige] credit report sync did not complete` log line carrying only the step, when it happens.
KEYBOARD_FOCUS: PASS: no control was added, removed or reordered; the panel is static text, and the chat's keyboard path is unchanged (measured for R3 on the same harness).
ZOOM_REFLOW: PASS: 200% zoom of 1366x768 (683x384 CSS pixels at device scale 2): the sentence reflows inside the panel, nothing clipped, nothing scrolling sideways.
REDUCED_MOTION: PASS: no motion was added or changed; the panel has none.
STATE_COVERAGE: PASS: a sync stopped before its first write (the nothing-added sentence); a sync stopped after it, or at a step nobody has named (the did-not-finish sentence); a report waiting on review and one with nothing to propose (their server sentences, unchanged, emitted before this function); a completed sync (unchanged); an older server's frame on the new panel (no step drawn).
TRUTHFUL_STATE_LABELS: PASS: "none of them were added to your profile" appears only for the three steps that stop before the pipeline's first write, and 30.33 and 30.36 assert nothing was written on them; after it the sentence says only that it did not finish and suggests no re-upload (30.35, unit). Of the two recoveries it names, a new upload runs the pipeline afresh; the failed upload itself stays marked as processing, so the business's upload screen still shows it as analysing (a filed follow-up, not this change).
SOLO_UI: NO: the client portal's chat (/app, PaigeChat mounted by AppShell) is the client's surface, not the Solo shell; the owner's chat does not render this panel.
UNVERIFIED: the authenticated run on a live client portal; that production's sync has failed and shown the sentence.

OWNER_INTENT: nothing internal reaches a customer; the credit-report sync panel stops showing uploaders raw error text and internal step names (owner ruling, R3b as the small PR after R3).
MUST_NOT_HAPPEN: a completed sync's panel changes; a report waiting on review loses its sentence; a failure stops looking like a failure; the pipeline's text or step reaches the uploader; a sentence claims nothing was added after something was written; the raw cause is lost from the server log.
MUST_PRESERVE: the panel's layout, header, list and colours; the awaiting-review and nothing-to-propose frames; the proposal a readable report reaches.
ACCEPTANCE_CRITERIA: a client whose credit report could not be synced reads "Sync Incomplete" and a sentence saying what happened and what to do, with no step name and no "Error:" label; "none of them were added" only when nothing could have been; a completed sync reads as before.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: tested — the sync_status frame on the credit path (30.33, 30.35, 30.36, 30.15, 30.16), the proposal a readable report reaches (30.34), the panel's awaiting-review and success states (vitest); unaffected and named — the extraction proposal frame, sync-credit-report-data itself, the document summary, R3's withheld turn.

INTERNAL_BUILD_IDENTITY: 7724508589f06e306be84ef5b4172e806a0f4894; deployment=none-pre-merge; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(paige-ai-chat redeploys through deploy-edge-functions on merge, and its deployed version and byte check are recorded in the delivery-log closeout); evidence=this-record-and-docs/evidence/ui-delivery/credit-sync-message/
RELEASE_CHANNEL: development: the identity above names the code head this record attests; paige-ai-chat redeploys through deploy-edge-functions and the portal through Vercel on merge
RELEASE_CLASSIFICATION: patch: a fix to what a client reads when their report could not be synced
CUSTOMER_RELEASE_IDENTITY: none: a reliability fix recorded internally, not a customer release
RELEASE_NOTE_REQUIRED: NO: no capability or action changes; only the words on an existing failure change
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the sentences are proven on the real handler and in the real portal chat on a harness; the authenticated run is owed after deploy
RELEASE_RECOVERY: position=forward-fix — no migration and no data written, and a revert of the squash restores the previous text; reference=client-memory-authz 30.33, 30.35 and 30.36, client-seat-reply.test.ts and SyncStatusPanel.awaitingReview.test.tsx pin the behaviour

## Scope and collisions

- Classification: Quick; one server emit (two call sites), one panel line, and a harness option that lets the credit pipeline get past its parse.
- Affected flows: a client's credit-report upload whose sync does not complete.
- Neighboring regressions: the other sync_status frames, the extraction proposal, the document summary, R3's withheld turn.
- Active-owner/file collisions: none; R3 (#1522), which touches the same handler, merged before this branch was cut.
- Explicit exclusions: the panel's design (emoji header, six-item list) is its existing design and not this fix.

## User job and state map

A client uploads their credit report; PAIGE reads it and the platform pulls its details out as a proposal for them to review. When that does not complete, the panel says so and names what to do: before the pipeline's first write, that nothing was added and they can upload again; after it, only that it did not finish, and to ask the business. The scroll owner is the chat's message list, unchanged.

## Evidence index

- Handler: `npm run test:client-memory-authz` (423/0; R3b is 30.33–30.36), `npm run test:knowledge-scope` (375/0), `npm run test:client-seat-reply` (18/18).
- Portal: `npx vitest run src/components/chat/SyncStatusPanel.awaitingReview.test.tsx` (6/6).
- Render: `node scripts/live-drive/paige-chat-sync-render.mjs` (11/11; `credit-sync-message/drive-results.json`), and with `BEFORE_ONLY=1` from a checkout of the base commit (1/1; `before-results.json`); frames in `credit-sync-message/`: tenant context "Northside Fitness", synthetic data only.
- Static: ESLint exit 0 on the changed files (the harness mount's one react-refresh warning is on the base file too); `ci:regression` exit 0 against the base; `ci:tsc` 12 → 12; `impeccable detect --json src/components/chat/SyncStatusPanel.tsx` → [].

## Review and limitations

- Two independent §39 reviews of the real diff. The first found one MAJOR: a single failure sentence said nothing from the report was saved even after the pipeline had written a client memory note. It was fixed by splitting the sentence on the pipeline's first write (30.35). Its minors were fixed too: a raw error passed on a report waiting on review, untyped fields, a dead workspace-changed case, and a no-upload-record duplicate.
- The second found no BLOCKER or MAJOR. It confirmed the write order by walking the pipeline and driving a validation failure. Its one real finding, that nothing tested the nothing-added sentence against what was written, is fixed: 30.33 and 30.36 assert no memory note or upload stamp, and a memory note slipped in before either early return now turns them red.
- Limits:
  - A failure before the first write leaves the upload row marked as processing, so the business's upload screen and PAIGE's context still describe it as being analysed.
  - The pipeline writes an exception's own text to the upload row, and PAIGE's context reads it back.
  - The handler's awaiting-review sentence says nothing has been saved after the memory note.
  - The handler's outer catch is correct by reading, and no harness reaches it.
  - The panel's existing credit labels are its design.
  - All five are filed, not changed here.
