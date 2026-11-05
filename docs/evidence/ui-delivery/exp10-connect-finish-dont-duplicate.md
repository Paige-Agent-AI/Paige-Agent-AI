# UI delivery evidence: EXP10 — finish-don't-duplicate connect guard + HighLevel's one-mode contract on both doors

Covers THIS branch's only src/solo deltas, all inside the Integrations connection form and
its wall (src/solo/settings-integrations-gateway.tsx + its test): (1) a duplicate-guard in
ConnectionForm.save — an add flow may never create a second connection for a server the
workspace already holds; a WORKING row blocks the create with a plain explanation, an
UNFINISHED row is finished (the save becomes that row's replacement and the receipt says
so); (2) the curated auth contract now governs BOTH doors into the form — the catalogue
preset and the re-key of a row the catalogue recognizes — so HighLevel presents exactly its
one proven mode (Private Integration Token + required locationId header) and Slack its user
token, where the owner previously met a four-way OAuth/Token/Token+headers/None wall on the
re-key of his unfinished HighLevel row (owner finding 2026-11-04, ANT-164); (3) wall copy: a
saved-but-never-finished row reads "Setup not finished" instead of the twin riddles "not
usable yet · Turned off"; (4) drawer eyebrow "Connected MCP Gateway" → "MCP server
connection". Production grounding: the owner's workspace held exactly the trap — a generic
GoHighLevel row saved with no auth (Sep 28) and a Slack row with no auth (Oct 25) — every
retry read as "it creates an additional connection".

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: the affected flows are the existing add-connection form and the existing re-key form; the guard changes what a save targets (existing row vs new row) and the curated contract changes which auth choices render; no new screen, route or drawer is introduced.
PAIGE_UI_DESIGN: PASS: Impeccable context + craft-floor loaded this session (standing EXP10 discipline); zero component, token or layout bytes change — the incumbent segmented control, receipt block, message line and tile idioms render exactly as before with different, truthful strings.
MATERIAL_FLOW_CHANGE: NO: the save flow's visible steps are unchanged; what changes is honesty of routing (an unfinished row is completed rather than duplicated) and of the auth choice set (a curated provider's one proven mode instead of four).
FLOW_PROTOTYPE: NOT_REQUIRED: non-material; the form, drawer and wall structures are the incumbent ones prior records evidenced.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a non-technical owner retrying a half-done connect now completes that connection and is told so in one sentence; an owner re-keying HighLevel answers one question in the provider's own words (paste your Private Integration Token) instead of a developer's four-mode question.
VISUAL_DIRECTION: PASS: incumbent visual language only; the removed tile chip and renamed eyebrow reuse existing classes verbatim.
AUTOMATED_EVIDENCE: PASS: three new tests pin the behavior end to end (HighLevel locked contract incl. the locationId header requirement and the create body; an unfinished row finished via the rekey writer with zero creates and the receipt sentence; a working row blocking the duplicate with zero writes) and the truth-boundary test follows the new chip vocabulary; tsc --noEmit clean on the changed files.
STATIC_EVIDENCE: PASS: typecheck filtered clean on the edited file; the lock, guard and receipt are pure functions of existing shape.
RENDERED_EVIDENCE: UNVERIFIED: no local browser render this slice; every touched element (segmented auth control, receipt block, message line, wall tile chip, drawer eyebrow) reuses the exact structures prior captures evidenced; owed and named.
BEHAVIORAL_EVIDENCE: PASS: the guard's three outcomes and the locked selector's single pressed button are each driven by an automated test through real clicks and typed values.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated drive this slice; the owner's own next connect (HighLevel first, then Slack) on the deployed surface is the owed proof.
KEYBOARD_FOCUS: PASS: unchanged — the incumbent focus effects (first-invalid-field, receipt focus, dirty-exit guard) are untouched; the locked selector is still a button group.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: guard covers all three relations to an existing row (none → create; unfinished → finish; working → refuse); the curated lock covers both doors while unrecognized rows keep all four modes; the wall chip covers the unfinished state in the surface's own vocabulary.
TRUTHFUL_STATE_LABELS: PASS: a dead row is never rendered "Turned off" as its headline truth (that is a deliberate state, not a half-done save); the refusal message names the working connection and the recovery (open it from your list); the receipt states plainly that a second connection was not added.
SOLO_UI: YES: src/solo/settings-integrations-gateway.tsx is the Solo settings Integrations connection surface.
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no rendering structure changes; touched strings render in incumbent structures whose viewport behavior prior records evidenced.
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: same.
UNVERIFIED: rendered capture and the authenticated connect drive are owed and named above; automated coverage is the graded half this slice claims.
OWNER_INTENT: owner directives 2026-11-04 (chat + ANT-164) — connect attempts must stop looking like duplicate creation; HighLevel must present as the token connection it is; the entire area must become comprehensible to a non-technical owner (this slice is the first of the reorganization).
MUST_NOT_HAPPEN: a second connection row for a server the workspace already holds; a four-mode auth question on a provider with one proven contract; any credential value, provider payload or raw error text crossing into the UI.
MUST_PRESERVE: the generic "Any MCP server" entry keeps all four modes (its own documented contract — pinned by the existing test); rows the catalogue does not recognize keep every mode on re-key; every other catalogue preset's behavior byte-identical.
ACCEPTANCE_CRITERIA: the owner opens HighLevel, sees one question in the provider's own words, pastes the Private Integration Token and locationId, and the receipt tells him he finished his existing connection; retrying any half-done connect never adds a row.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: NONE_AFFECTED: the gateway writers (create/rekey) and their server-side guards are untouched; this delta is form routing and copy only.

INTERNAL_BUILD_IDENTITY: 4ddae239c695aea6cd8e6553d76dda631af64eb1 (exp10-integrations-connect-a changeset off origin/main); deployment=vercel-preview-per-push; environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp10-connect-finish-dont-duplicate.md
RELEASE_CHANNEL: preview: unmerged branch; Vercel preview deploys per push only
RELEASE_CLASSIFICATION: internal-only: connect-form honesty and copy on the authenticated Solo Integrations surface; no customer release identity until the owner's own connect drive exercises it
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only until the owner's HighLevel/Slack connect
RELEASE_TRUTH_BOUNDARY: PROOF OWED: ships on merge; the owner's first completed HighLevel connect (and the dead rows either finishing or being removed by him) is the owed live proof
RELEASE_RECOVERY: position=revert-restores-four-mode-rekey-and-unchecked-creates; reference=this record plus the revert commit
