# UI delivery evidence: Marketing email E2b — PAIGE's email tools in chat

The owner asked for E2b after E2 merged: "Merge when green, then start E2B." PAIGE can now read the business's
email campaigns, count who one would reach, write or change a draft, and file a draft for the owner's approval.
She cannot approve or send. The visible changes are small: the open campaign editor notices when PAIGE has
changed its campaign, and Marketing › Email's PAIGE prompts ask her to save a draft instead of telling her she
cannot.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flows - (1) owner asks PAIGE to draft an email and it appears as a draft in Marketing › Email; (2) owner asks PAIGE to change a campaign while its editor is open, with nothing unsaved, and the editor shows PAIGE's version; (3) the same with unsaved edits, and the owner is told and can take PAIGE's version or keep typing; (4) owner asks PAIGE to file a draft and approves the send in Marketing › Email; (5) an agency manager, a member or another business is refused before any approval card
PAIGE_UI_DESIGN: PASS: Impeccable craft floor applied to the one new element: an existing me-notice is-warn status line with an existing secondary button, owner words, no new colour, no gold
MATERIAL_FLOW_CHANGE: NO: the editor and dashboard layouts are unchanged; one conditional status line and three prompt strings
FLOW_PROTOTYPE: NOT_REQUIRED: no new screen or layout; the status line reuses the editor's notice row
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Solo owner or admin; primary action is asking PAIGE to draft or file, then approving the send in Marketing › Email
VISUAL_DIRECTION: PASS: unchanged from E2 (me-* on the mo-* system); the new line is the editor's existing warn notice
AUTOMATED_EVIDENCE: PASS: email-campaign-chat.test.ts (20: create keyed against retries, change, read-back of every field set, refusals in owner words, local validation kept off the activity feed, send time needs an offset, agency refusal, HTML body note, seat gate, write schemas extendable and read schemas frozen); marketing-email.render.test.tsx (+3: PAIGE's change replaces the editor's when nothing is unsaved, a turn that changed nothing leaves it alone, unsaved edits get the notice and Show PAIGE's version); confirm-fingerprint.test.ts (the create key never changes a card and every drafted field does); each guard reinstated as a defect fails its test
STATIC_EVIDENCE: PASS: tsc 10 errors, identical to main; lint:tool-catalogue, write-targets, action-risk, receipt-coverage, approval-gate, chat-tool-registry, capability-declaration, capability-kit, paige-spine-registry, definer-fns, migration-versions, tier-features and test:client-memory-authz pass
RENDERED_EVIDENCE: PASS: scripts/live-drive/marketing-views-drive.mjs re-run on this branch; see the PR for the count
BEHAVIORAL_EVIDENCE: PASS: jsdom drives of the editor's reaction to a settled chat turn; rolled-back production proofs of every new RPC path
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the owner asking PAIGE for a draft in the signed-in chat is owed
KEYBOARD_FOCUS: PASS: the new button is a native button with the violet focus ring, inside a role=status line
ZOOM_REFLOW: PASS: the notice wraps inside the editor column like the existing notices
REDUCED_MOTION: PASS: no motion added
STATE_COVERAGE: PASS: editor with nothing unsaved (PAIGE's version shown, "PAIGE updated this campaign."), with unsaved edits (notice + Show PAIGE's version), turn that changed nothing (no change); chat refusals for member, agency, other business, stopped, awaiting approval, owner-filed, size limit, past time
TRUTHFUL_STATE_LABELS: PASS: a write is reported only after a fresh read shows it; a database-named refusal says nothing changed; anything else is reported as unknown; filing says the owner still approves the send
SOLO_UI: YES: Solo Marketing › Email, /solo/{account}/growth/email

SOLO_1536X770_PAIGE_CLOSED: PASS: Marketing drive re-run, layout unchanged from E2
SOLO_1536X770_PAIGE_OPEN: PASS: Marketing drive re-run, docked and expanded
SOLO_1366X768_PAIGE_CLOSED: PASS: Marketing drive re-run
SOLO_1366X768_PAIGE_OPEN: PASS: Marketing drive re-run
SOLO_1024X768_PAIGE_CLOSED: PASS: Marketing drive re-run
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: Marketing drive re-run
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: PAIGE can draft and file email campaigns from chat, and never approves or sends (owner, 2026-10-04/05: "PAIGE never approves or sends"; "one bounded approval"; "Merge when green, then start E2B")
MUST_NOT_HAPPEN: PAIGE approving or sending; a second campaign from a retried request; PAIGE acting in a business other than the one the chat is in; the open editor silently saving over PAIGE's change; PAIGE credited with a filing the owner made
MUST_PRESERVE: the E2 dashboard and editor as merged; the one approval (email_campaign_approve, human-only); the editor's save-before-leave and serialised saves; every other chat tool's approval behaviour
ACCEPTANCE_CRITERIA: on the live app the owner asks PAIGE to write a campaign email, sees it as a draft in Marketing › Email, asks her to file it, and approves the send there
MOTION_PURPOSE: none added
PROTECTED_SEAMS: tested - the E2 editor saves (serialised, Back, unmount), confirm-fingerprint ignore list, workspace authority, capability status wiring, campaign brief chat reach, approval stored-proposal execution; unaffected and named - Sales and CRM doors (their seat set is extended, not changed), the worker renderer (only the markup source moved, re-exported)

INTERNAL_BUILD_IDENTITY: 8a0f9a6124bea7e3b2c36292e9851c113a972739; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20270564000000 applies through deploy-migrations.yml on merge after its rolled-back production proofs passed); edge=PROOF_OWED(paige-ai-chat deploys through deploy-edge-functions.yml on merge); evidence=src/__tests__/email-campaign-chat.test.ts
RELEASE_CHANNEL: development: verified locally; production on merge per the owner ("Merge when green, then start E2B")
RELEASE_CLASSIFICATION: internal-only: pre-launch, no customers
CUSTOMER_RELEASE_IDENTITY: none: pre-launch, no customers
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: tools verified by tests and rolled-back production proofs; the signed-in chat drive is owed
RELEASE_RECOVERY: position=revert the merge commit (the migration only adds functions, a nullable column with its index, and catalogue and activity wrappers); reference=git revert of this PR's merge commit
UNVERIFIED: the signed-in chat on production asking PAIGE to draft and file a campaign (no tenant login in this session).

## Scope and collisions

- Classification: chat capability on an existing surface; additive migration.
- Affected flows: the five above.
- Neighboring regressions: the E2 editor's saves; other chat tools' approval matching; the Sales and CRM door seat checks.
- Active-owner/file collisions: none found on main at the time of writing.
- Explicit exclusions: sequences (E3); the sub-account tree's Email screen; making the filing step ungated (owner decision, see the PR).

## Evidence index

- `npx vitest run src/__tests__/email-campaign-chat.test.ts src/solo/marketing-email.render.test.tsx src/__tests__/confirm-fingerprint.test.ts`.
- `node scripts/live-drive/marketing-views-drive.mjs`.
- Production proofs (rolled back): see the PR.

## Review and limitations

An independent adversarial verifier and a compliance officer reviewed the diff; their findings and fixes are listed in the PR.
