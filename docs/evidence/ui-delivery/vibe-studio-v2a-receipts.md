# UI delivery evidence: vibe-studio-v2a-receipts

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounded on production before editing — in 30 days no page, funnel or content save left a receipt, form receipts were wired but never fired, images were the only Studio act on the Rail, and the single approval card ever raised for a copy draft was never answered. Flow: a Studio act runs or is refused → one receipt is filed through record_capability_run → it appears on the Rail; a copy draft runs without an approval card and saving it still asks first
PAIGE_UI_DESIGN: PASS: no Studio interface file changed; the activity Rail renders the new receipts with its existing component
MATERIAL_FLOW_CHANGE: YES: copy drafts no longer raise an approval card (owner ruling 2026-10-04); every Studio save, publish and pre-write refusal now appears on the activity Rail; the operator settings no longer offer acting alone for form publishing
FLOW_PROTOTYPE: PASS: no new surface; receipts reuse the shipped Rail and the drafts change removes a card
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Solo owner/admin building in the Studio and reading what Paige did on the Rail; primary actions unchanged
VISUAL_DIRECTION: PASS: unchanged (layout C)
AUTOMATED_EVIDENCE: PASS: src/__tests__/studio-run-outcome.test.ts (8) and scripts/client-memory-authz/check.mjs 514/514 including 33.5c, 33.5g and 34.1-34.6 against the real chat handler; full vitest 7,787/7,787; Migration D contract suite 1,683 checks on Postgres 16; src/__tests__/studio-draft-authority.test.ts drives the seven draft, edit, route, critique and learn handlers; removing the new receipt keys, the Studio image skip, the refusal receipts, the drafts exemption, or the gate additions each turns its checks red
STATIC_EVIDENCE: PASS: deno check --no-lock on paige-ai-chat matches main line for line, 12 errors before and after; lint:action-risk, lint:receipt-coverage, capability-declaration and capability-kit lints pass
RENDERED_EVIDENCE: PASS: no UI change; the current frames are docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/ (harness render · not live)
BEHAVIORAL_EVIDENCE: PASS: harness section 34 drives a saved page, a lost answer, a not-owner refusal, a switched-off act, images in and out of a project, and a copy draft under confirm through the real handler
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in browser here; owed — a signed-in owner saves a page in the Studio and sees it on the activity Rail, and drafts copy with no approval card
KEYBOARD_FOCUS: PASS: no interface change
ZOOM_REFLOW: PASS: no interface change
REDUCED_MOTION: PASS: no interface change
STATE_COVERAGE: PASS: succeeded / refused before the write / refused by the backend / failed / unknown / unreachable / image still rendering (no receipt from chat)
TRUTHFUL_STATE_LABELS: PASS: an unproven publish is unknown, never refused or done; an image is counted once
SOLO_UI: YES: Solo Marketing → Vibe Studio → a project, and the activity Rail
SOLO_1536X770_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1536x770-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no Studio UI file changed; receipts surface in the existing activity Rail and drafts simply no longer raise an approval card); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1536X770_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1536x770-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no Studio UI file changed; receipts surface in the existing activity Rail and drafts simply no longer raise an approval card); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1366X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1366x768-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no Studio UI file changed; receipts surface in the existing activity Rail and drafts simply no longer raise an approval card); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1366X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1366x768-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no Studio UI file changed; receipts surface in the existing activity Rail and drafts simply no longer raise an approval card); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1024X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1024x768-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no Studio UI file changed; receipts surface in the existing activity Rail and drafts simply no longer raise an approval card); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1024X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1024x768-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no Studio UI file changed; receipts surface in the existing activity Rail and drafts simply no longer raise an approval card); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_900X1000_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-900x1000-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no Studio UI file changed; receipts surface in the existing activity Rail and drafts simply no longer raise an approval card); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_900X1000_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-900x1000-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this change (no Studio UI file changed; receipts surface in the existing activity Rail and drafts simply no longer raise an approval card); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
UNVERIFIED: authenticated runtime (above)

OWNER_INTENT: "Drafts skip approval is a go." and "Migration D authorized" (2026-10-04); the governance direction: one PAIGE architecture, no parallel receipts
MUST_NOT_HAPPEN: a Studio act that changes something without a receipt; an image counted twice; a draft blocked behind an approval card; saving or publishing running without approval where the workspace asks first
MUST_PRESERVE: every approval on saves and publishes; paige-media's own image receipts; the existing Rail
ACCEPTANCE_CRITERIA: after deploy, a Studio page save and a content save each appear once on the owner's Rail, and a copy draft returns without an approval card
MOTION_PURPOSE: none
PROTECTED_SEAMS: record_capability_run unchanged; resolve_tool_autonomy unchanged; paige-media unchanged

INTERNAL_BUILD_IDENTITY: 05a79c69c887608c1bddc02f04a0354ab737a586 plus later commits in this PR; deployment=local; environment=development; migrations=PROOF_OWED(Migration D lands in this PR and is applied by deploy-migrations on merge, then confirmed from schema_migrations); edge=PROOF_OWED(paige-ai-chat and the Studio functions deploy on merge); evidence=docs/evidence/ui-delivery/vibe-studio-v2a-receipts.md
RELEASE_CHANNEL: development: verified locally and by an independent reviewer before merge; edge and migrations deploy through CI on merge (pre-launch merge-on-verified, §4)
RELEASE_CLASSIFICATION: internal-only: no customer release identity
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: no: internal-only governance change
RELEASE_TRUTH_BOUNDARY: PARTIAL: ships on merge; LIVE after the deploy runs, the persisted-migration check and the owed authenticated drive
RELEASE_RECOVERY: position=forward-fix, a revert restores the previous receipts and gate; reference=deploy-edge-functions and deploy-migrations run on merge

## Scope and collisions

- Classification: Studio governance — receipts, drafts approval, workspace authority, Migration D, Spine declarations.
- Explicit exclusions: V2b one publish path; the operator settings list beyond the Studio tools.

## Review and limitations

Independent review: pending; recorded on the PR when it returns.
