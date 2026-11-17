# EXP06: Publish the page that was reviewed

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: FLOW:BRAND rows 5–7 and 19; flow and negative controls below.
PAIGE_UI_DESIGN: PASS: the existing Studio and Team Hub approval and refusal surfaces carry the changed authority outcome; no interface or motion is redesigned.
MATERIAL_FLOW_CHANGE: YES: changing the saved page or native destination invalidates an open approval.
FLOW_PROTOTYPE: UNVERIFIED: this server-only change uses the existing approval and refusal states; exercise the real states after the normal release.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a workspace owner or admin reviews the saved page and its public address, then approves that exact publication.
VISUAL_DIRECTION: NOT_APPLICABLE: existing cards, layout, typography, and motion are unchanged.
AUTOMATED_EVIDENCE: PASS: 103 focused Vitest checks; includes failing-first draft change and overlapping fresh card cases, destination changes, and the original authority, audit, and no-repeat paths.
STATIC_EVIDENCE: PASS: inspected the original page writer, tenant and actor checks, both card consumers, and the production migration frontier; exact release gates remain separate.
RENDERED_EVIDENCE: UNVERIFIED: no changed-build browser render yet; there is no new visual surface.
BEHAVIORAL_EVIDENCE: UNVERIFIED: the old build allowed a privately saved synthetic draft and a Team Hub lookup; no public act was taken.
AUTHENTICATED_RUNTIME: UNVERIFIED: exact-build Team Hub approval, public readback, and receipt reopen are owed after deploy and exact publication authority.
KEYBOARD_FOCUS: NOT_APPLICABLE: no focus order, controls, or keyboard interaction changed.
ZOOM_REFLOW: NOT_APPLICABLE: no layout or geometry changed.
REDUCED_MOTION: NOT_APPLICABLE: no animation or motion changed.
STATE_COVERAGE: PASS: focused suites cover ready, same review, expired, stale draft, stale path, wrong workspace, wrong actor, concurrent fresh proposal, and an unknown write response.
TRUTHFUL_STATE_LABELS: PASS: the writer refuses stale reviews, and the existing card settles without claiming the page went live.
SOLO_UI: NO: the shared page publishing authority changed; no Solo interface source changed.
UNVERIFIED: managed Preview, production DB and Edge readback, authorized public effect and receipt reopen are separate release and customer proof.

OWNER_INTENT: Publish the saved Studio page the owner reviewed through the existing Team Hub approval, verify what the public sees and reopen the same result.
MUST_NOT_HAPPEN: An old approval must not publish newer content, change the destination, or cancel a separate review of a newer draft.
MUST_PRESERVE: The existing action subject, card, actor and workspace checks, native publisher, single-use claim, and Rail receipt remain authoritative.
ACCEPTANCE_CRITERIA: A changed review refuses without publishing; a fresh card can proceed once; the authorized published bytes, address and saved receipt agree after reload.

INTERNAL_BUILD_IDENTITY: 4f76be05083257696776ea4fe8b935afc2baf46c; deployment=local-source-only; environment=local; migrations=PROOF_OWED(managed Preview and production application); edge=PROOF_OWED(released growth-publish-command bundle); evidence=src/__tests__/growth-publish-door-review.test.ts
RELEASE_CHANNEL: development: local source and test evidence; no production mutation from this repair.
RELEASE_CLASSIFICATION: patch: close a publication authority gap in the existing flow.
CUSTOMER_RELEASE_IDENTITY: none: internal repair without a release announcement.
RELEASE_NOTE_REQUIRED: NO: patch to preserve already intended review behavior.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: authenticated approval, public readback, receipt and reopen on the exact released build.
RELEASE_RECOVERY: position=forward-fix; reference=restore the matched schema and Edge path without re-enabling unbound approval.

## Scope and flow

EXP06 extends the existing page publication command. EXP08 keeps the Team Hub card presentation and EXP01 keeps PAIGE Chat. The flow is saved draft → review from Studio or either chat → confirm the same review → existing publisher → existing receipt and result. If the draft or native URL changes, the old action fails. A separate review can proceed. A lost response still requires inspecting the project and original receipt before another attempt.

The SQL migration and Edge release are both required. An older Edge bundle on the new schema refuses the unbound call; a newer bundle on the old schema cannot prepare a verified review. Allow page publish QA only after both are confirmed. No provider, DNS, new approval store, client, or publish writer is involved.

## Reproduction and verification

Run `npm test -- src/__tests__/growth-publish-door-review.test.ts src/__tests__/growth-publish-door.test.ts src/__tests__/growth-publish-door-unpublish.test.ts src/__tests__/growth-publish-chat.test.ts src/__tests__/growth-publish-summary.test.ts`.

The existing `supabase/tests/growth_public_publication.sql` checks the upgraded writer with the real authorization and public read contracts on isolated schema. It adds stale revision, mismatched destination, old signature and grant checks to the existing publication, unpublish and restore proof. The authenticated receipt leg is not included in these tests.
