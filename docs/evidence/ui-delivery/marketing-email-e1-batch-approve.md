# UI delivery evidence: Marketing email E1 — batch approve leaves campaign sends alone; Audience marked frozen

E1 is the sending foundation for Marketing › Email (campaigns, one bounded approval, a durable dispatcher).
Its only interface changes are two: "Approve all" on Drafts awaiting you no longer approves an email
campaign (owner ruling 2026-10-04: a campaign has one bounded approval, given on its own), and the
Audience view carries an APPROVED-FROZEN (§28) comment after the owner approved it ("Yes, it's working
perfectly", 2026-10-04). The Audience change is a source comment only; nothing it renders changed.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow - an owner approving the drafts PAIGE queued for them, in a batch; grounding - DraftsAwaitingPanel.tsx approveAll loops visible rows through execute-approval, which since E1 routes a campaign_send to email_campaign_approve; a batch would approve a send to many people in a click meant for routine drafts. Regression map - single-row approve, decline and edit through ApprovalRow are untouched; the Operator and Practice Command Centers render the same panel
PAIGE_UI_DESIGN: PASS: Impeccable Operate mode; no visual change - the batch control keeps its existing variant and placement, and its count now names exactly the drafts it will act on
MATERIAL_FLOW_CHANGE: YES: Approve all skips campaign sends and counts only what it approves; with one other draft beside a campaign send no batch control is offered
FLOW_PROTOTYPE: PASS: owner-intent reference - the 2026-10-04 marketing email architecture rulings (one bounded approval per send, any edit invalidates it); the existing panel is the surface, unchanged in look, and the jsdom drive in DraftsAwaitingPanel.campaign.test.tsx exercises the changed consequence
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: the owner clears routine drafts in one click; a campaign send is approved on its own row
VISUAL_DIRECTION: PASS: unchanged; existing secondary button, existing tokens
AUTOMATED_EVIDENCE: PASS: DraftsAwaitingPanel.campaign.test.tsx 2/2 - Approve all (2) with three rows of which one is a campaign send, and execute-approval called for the other two only; no batch control when one draft sits beside a campaign send. Both tests fail against main's panel (reinstated and run). Full vitest after merging main 555 files / 8,077 tests (before this test was added)
STATIC_EVIDENCE: PASS: tsc 10 errors, identical to main; lint:definer-fns, lint:migration-versions pass
RENDERED_EVIDENCE: NOT_APPLICABLE: no visual change; the button's label text is asserted in jsdom
BEHAVIORAL_EVIDENCE: PASS: jsdom click on Approve all; execute-approval invocations recorded per row id
AUTHENTICATED_RUNTIME: UNVERIFIED: no tenant login in this session; the owner's next look at Drafts awaiting you with a campaign send queued confirms it live
KEYBOARD_FOCUS: PASS: unchanged native button with the existing focus ring
ZOOM_REFLOW: PASS: unchanged layout
REDUCED_MOTION: PASS: no motion added or changed
STATE_COVERAGE: PASS: no drafts (All clear), one draft (no batch), several drafts with and without a campaign send, batch in progress (spinner), batch result toast with real per-row counts
TRUTHFUL_STATE_LABELS: PASS: the count on Approve all is the number of drafts the click will act on
SOLO_UI: YES: the Audience view file (src/solo/marketing-audience.tsx) gained a source comment only; no rendered change

SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: the Solo file change is a source comment; nothing rendered changed
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: the Solo file change is a source comment; nothing rendered changed
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: the Solo file change is a source comment; nothing rendered changed
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: the Solo file change is a source comment; nothing rendered changed
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: the Solo file change is a source comment; nothing rendered changed
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: the Solo file change is a source comment; nothing rendered changed
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: the Solo file change is a source comment; nothing rendered changed
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: the Solo file change is a source comment; nothing rendered changed

OWNER_INTENT: one bounded approval per campaign send, given on its own; the owner never approves a send to many people by accident (owner rulings 2026-10-04)
MUST_NOT_HAPPEN: a campaign send approved by Approve all; a batch count that includes rows the click skips
MUST_PRESERVE: single-row approve, edit and decline; batch approve for every other draft type; the real per-row result toast
ACCEPTANCE_CRITERIA: with a campaign send and two other drafts waiting, Approve all reads (2) and approves only those two; the campaign send stays waiting with its own Approve
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: tested - execute-approval invocation per row; unaffected and named - ApprovalRow single approve/decline, usePendingApprovals, Audience rendering

INTERNAL_BUILD_IDENTITY: 2126aede82d9774f5eae14847cdf9d3b29eaf09c; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20270549000000 applies through deploy-migrations.yml on merge); edge=PROOF_OWED(email-campaign-worker, send-message and execute-approval deploy on merge); evidence=src/components/dashboard/DraftsAwaitingPanel.campaign.test.tsx
RELEASE_CHANNEL: development: verified locally; production on merge per the owner ("Merge it when green")
RELEASE_CLASSIFICATION: internal-only: a batch-action guard and a source comment
CUSTOMER_RELEASE_IDENTITY: none: no customer announcement or version
RELEASE_NOTE_REQUIRED: no: pre-launch, no customers
RELEASE_TRUTH_BOUNDARY: PARTIAL: verified in jsdom; live confirmation owed
RELEASE_RECOVERY: position=revert the merge commit; reference=git revert of the PR's merge
UNVERIFIED: the batch control on the live app, signed in, with a real campaign send queued (no tenant login in this session; no campaign send can exist live until E1's migration applies on merge).

## Scope and collisions

- Classification: guard on an existing batch action; source comment on a frozen view.
- Affected flows: approving queued drafts in a batch.
- Neighboring regressions: single-row approval; Command Center panels that render the same component.
- Active-owner/file collisions: none found on main at merge time.
- Explicit exclusions: the Email dashboard and editor (E2).

## Evidence index

- `npx vitest run src/components/dashboard/DraftsAwaitingPanel.campaign.test.tsx` → 2 passed; same file against main's panel → 2 failed.

## Review and limitations

The E1 adversarial review raised batch approval of campaign sends (S3); this record covers the fix and the
count correction found while writing it. Live confirmation is owed.
