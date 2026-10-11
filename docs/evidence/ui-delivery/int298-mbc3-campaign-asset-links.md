# UI delivery evidence: INT-298/INT-342 MBC slice 3 — a campaign shows what it uses

Coordinator command "Marketing Backend Completion & Analytics Ownership" (owner-authorized; INT-298, INT-342, Linear
ANT-15), slice 3 of 6: campaign ↔ asset links. Backend (3a): `campaign_brief_asset_links` with a governed writer and
read (`docs/delivery/campaign-asset-links-contract.md`). Surface (3b): the Campaigns dossier's "What this campaign uses",
the approved prototype's campaign-map Reach and Land lanes. Frames: `DRIVE_ONLY=flows node
scripts/live-drive/marketing-views-drive.mjs`; key frames in `assets/int298-mbc3-campaign-asset-links/`.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounding by a scout and by reading every asset table's schema and RLS (growth pages/forms/funnels, email campaigns and series, the content library, social posts), the brief writer and read this mirrors, the account-retirement disposition list (an unlisted tenant table blocks account deletion), the Finance injection precedent, the dossier and readiness code, and the approved prototype's campaign map. Searched campaign_brief_id, brief_id, campaign_id, campaign_tag, utm_campaign across every migration: only social posts carried a brief link. Flows: an owner opens a campaign and sees what it uses; attaches a page, form, funnel, email, series or library piece; removes one; a member reads it; the read fails
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode; the prototype's Reach and Land lanes inside the existing dossier, existing tokens, one small CSS block; a craft defect seen in the first frames (picker and Add rendered larger than the rows: a global button font rule won) fixed and re-shot; independent non-author review of the real diff run before merge (see PR)
MATERIAL_FLOW_CHANGE: YES: the dossier gains a section to attach and remove pieces, and readiness counts what is attached; nothing previously shipped is removed (§58)
FLOW_PROTOTYPE: PASS: the owner-approved INT-342 prototype drew this map (marked proposed until the link existed); pre-launch stance (CLAUDE.md §4, §69 pre-launch override)
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner or admin records which pages, forms and emails make up a campaign; a member sees it
VISUAL_DIRECTION: PASS: Solo tokens only (violet tint for kind chips, hairline borders), both themes, no gold, focus rings on every new control
AUTOMATED_EVIDENCE: PASS: useCampaignAssets.test.tsx (5): the governed read and writer, a change confirmed by re-reading, a change the read doesn't show reported as unconfirmed (shown to fail with that check removed), refusal sentences; growth2.render.test.tsx: admin attach and remove with only unattached pieces offered (shown to fail with that filter removed), the member view, the failed read. supabase/tests/campaign_brief_asset_links.sql on a local stub with each guard mutated: removing the asset tenant check, the deleted-asset filter, the member redaction or the retirement registration each fails it. Full unit suite: 729 files, 10,828 tests passed
STATIC_EVIDENCE: PASS: tsc 10 errors on the change and 10 on base (none in changed files); eslint 0 errors and no new warnings on changed files; impeccable@4.1.0 detect exit 0; every scripts/ci/*-lint.mjs passes; definer-fn-lint clean
RENDERED_EVIDENCE: PASS: DRIVE_ONLY=flows 42/42, including admin and member dossier flows in both themes at 1366 docked: lanes list what the campaign uses, Add offers only unattached pieces, attaching shows the row, the toast and the readiness count, Remove takes it off, a member sees no names they can't read and no controls, no overflow; frames looked at
BEHAVIORAL_EVIDENCE: PASS: the drive attaches and removes a form through the harness writer and reads it back
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the migration's behaviour is proven on a production-schema clone in database-contract
KEYBOARD_FOCUS: PASS: Add, each choice, Remove and Cancel are buttons; Escape closes the picker without closing the dossier; focus returns to Add
ZOOM_REFLOW: PASS: names truncate with an ellipsis; rows wrap their controls at every drive width
REDUCED_MOTION: PASS: no motion added
STATE_COVERAGE: PASS: loading (skeleton), failed read (says so, Try again), empty lane, admin, member, nothing left to attach, a filter with no match
TRUTHFUL_STATE_LABELS: PASS: attaching says nothing is sent or published; a change is reported only after the server's read shows it; a member sees "Owners and admins can see which" instead of a name
SOLO_UI: YES: Solo Marketing, /solo/{account}/growth/campaigns (the dossier)

SOLO_1536X770_PAIGE_CLOSED: PASS: the dossier is a fixed-width drawer; its layout does not depend on the canvas width (flows run at 1366)
SOLO_1536X770_PAIGE_OPEN: PASS: as above
SOLO_1366X768_PAIGE_CLOSED: PASS: admin and member flows, overflow 0 (DRIVE_ONLY=flows)
SOLO_1366X768_PAIGE_OPEN: PASS: docked content width, overflow 0 (DRIVE_ONLY=flows)
SOLO_1024X768_PAIGE_CLOSED: PASS: the drawer is the same fixed width; rows truncate rather than overflow
SOLO_1024X768_PAIGE_OPEN: PASS: PAIGE is an overlay below 1080px; layout equals PAIGE-closed
SOLO_900X1000_PAIGE_CLOSED: PASS: as 1024
SOLO_900X1000_PAIGE_OPEN: PASS: PAIGE is an overlay at 900px; layout equals PAIGE-closed

OWNER_INTENT: Campaigns shows a campaign's real composition, from records, not from free text
MUST_NOT_HAPPEN: another workspace's piece linked; a member shown email or library names; a link presented as a send or publish; a brief's version bumped by a link
MUST_PRESERVE: the dossier's brief, audience and offer, readiness, evidence links, lifecycle and actions; content needs as the fallback when nothing is attached
ACCEPTANCE_CRITERIA: on the live app a Solo owner opens a campaign's dossier, adds the landing page and form, sees them under Land and in readiness, reloads and still sees them; a member sees them without edit controls
MOTION_PURPOSE: none added
PROTECTED_SEAMS: tested - the brief seams unchanged (configure_campaign_brief, get_campaign_briefs), growth2 render and sales-ops contract with the new hook stubbed; unaffected and named - Overview, Analytics, Audience, Content, Social, Email, Ads

INTERNAL_BUILD_IDENTITY: 71f56e8bdb31a4b58b2efcca425f663749127a58; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20270602000504 is applied by deploy-migrations on merge and read back on production); edge=NOT_APPLICABLE; evidence=scripts/live-drive/marketing-views-drive.mjs
RELEASE_CHANNEL: development: verified locally; production on merge per the pre-launch stance (CLAUDE.md §4)
RELEASE_CLASSIFICATION: internal-only: a new planning link and its dossier section
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: authenticated production behaviour is PROOF OWED
RELEASE_RECOVERY: position=revert the merge commit for the surface - the table is additive and can stay empty; reference=git revert of this PR merge, plus a forward migration if the table must go
UNVERIFIED: authenticated production runtime (§32.c): attach and remove against a real Solo account; no tenant login in this session. Not built here: a Chat tool and Spine key (slice 6), the roll-up metric per linked piece.
