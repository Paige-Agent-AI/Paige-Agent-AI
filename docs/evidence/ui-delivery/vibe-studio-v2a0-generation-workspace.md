# UI delivery evidence: vibe-studio-v2a0-generation-workspace

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: grounded on production before editing — 11 people hold the platform-wide admin role and 10 are ordinary workspace owners; generate-image and content-draft are deployed exactly as on main (no edge-live drift). Flow: Studio or chat asks for an image or copy → the backend resolves the session workspace and checks owner/admin → the image or draft is filed under that workspace only
PAIGE_UI_DESIGN: PASS: no interface change; the only visible difference is the refusal message a caller sees in the refused cases
MATERIAL_FLOW_CHANGE: YES: a request naming another workspace is refused instead of written there; a workspace owner without the platform-wide role can now generate images through paige-media's legacy providers
FLOW_PROTOTYPE: PASS: no new surface; a backend tenant-isolation fix under the owner's D3 ruling (2026-10-03)
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Solo owner/admin generating an image or drafting copy; primary action unchanged
VISUAL_DIRECTION: PASS: unchanged (layout C)
AUTOMATED_EVIDENCE: PASS: src/__tests__/studio-caller-authority.test.ts (10 tests) and the updated media-seam-security-contract pin; 67 tests across every file that references these functions pass; reinstating the old generate-image, removing the foreign-workspace refusal, or loosening the permission check each fails the suite
STATIC_EVIDENCE: PASS: deno check reports 0 errors on both functions, baseline 0
RENDERED_EVIDENCE: PASS: no UI change; the current frames are docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/ (harness render · not live)
BEHAVIORAL_EVIDENCE: PASS: resolver unit tests drive every branch — session workspace returned for owner/admin, matching body tenant accepted, foreign body tenant refused, member refused, every lookup error fails closed, only literal true grants
AUTHENTICATED_RUNTIME: UNVERIFIED: no signed-in browser here; owed — a signed-in owner generates an image in the Studio and sees it in their own library, and a request naming another workspace is refused
KEYBOARD_FOCUS: PASS: no interface change
ZOOM_REFLOW: PASS: no interface change
REDUCED_MOTION: PASS: no interface change
STATE_COVERAGE: PASS: owner/admin of the session workspace (allowed) / member (refused) / no workspace (refused) / foreign workspace named (refused) / lookup error (refused)
TRUTHFUL_STATE_LABELS: PASS: a refused request says nothing was created; it is never filed elsewhere
SOLO_UI: YES: Solo Marketing → Vibe Studio → a project
SOLO_UI: YES: Solo Marketing → Vibe Studio → a project
SOLO_1536X770_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1536x770-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed; the Studio's image and copy tools call these backends through paige-media and chat); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1536X770_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1536x770-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed; the Studio's image and copy tools call these backends through paige-media and chat); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1366X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1366x768-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed; the Studio's image and copy tools call these backends through paige-media and chat); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1366X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1366x768-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed; the Studio's image and copy tools call these backends through paige-media and chat); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1024X768_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1024x768-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed; the Studio's image and copy tools call these backends through paige-media and chat); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_1024X768_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-1024x768-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed; the Studio's image and copy tools call these backends through paige-media and chat); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_900X1000_PAIGE_CLOSED: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-900x1000-paige-closed.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed; the Studio's image and copy tools call these backends through paige-media and chat); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
SOLO_900X1000_PAIGE_OPEN: PASS: docs/evidence/ui-delivery/assets/vibe-studio-v0-publish-truth/solo-900x1000-paige-open.png — structural harness (real Studio components and Solo CSS, stubbed reads; labelled "harness render · not live"): unchanged by this fix (no UI file changed; the Studio's image and copy tools call these backends through paige-media and chat); document overflowX 0, Publish and the timeline on screen. The Studio is a full-screen overlay, so PAIGE open and closed render the same frame.
UNVERIFIED: authenticated runtime (above)

OWNER_INTENT: "fix D3" — tenant-scoped owner/admin authority instead of the tenant-agnostic global role
MUST_NOT_HAPPEN: an image or library row filed into a workspace the caller does not own or administer; another workspace's brand read by a caller outside it
MUST_PRESERVE: image generation and copy drafting for the workspace's own owner/admin; paige-media's legacy dispatch; version stacking via reuse_content_id inside the caller's workspace
ACCEPTANCE_CRITERIA: after deploy, the Studio generates an image for a signed-in owner into their own library, and generate-image refuses a request naming another workspace
MOTION_PURPOSE: none
PROTECTED_SEAMS: studio_role_ok and current_user_tenant_id are read, not changed; save_marketing_content unchanged and tracked for V2a

INTERNAL_BUILD_IDENTITY: 72f249ebac3e0a408067121a27f38cf3338285c4 plus this record; deployment=local; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(generate-image and content-draft deploy on merge through deploy-edge-functions); evidence=docs/evidence/ui-delivery/vibe-studio-v2a0-generation-workspace.md
RELEASE_CHANNEL: development: verified locally and by an independent reviewer before merge; edge deploys through CI on merge (pre-launch merge-on-verified, §4)
RELEASE_CLASSIFICATION: internal-only: no customer release identity
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: no: internal-only security fix
RELEASE_TRUTH_BOUNDARY: PARTIAL: ships on merge; LIVE after the deploy run and the owed authenticated drive
RELEASE_RECOVERY: position=forward-fix, a revert restores the previous functions verbatim; reference=deploy-edge-functions redeploys on merge

## Scope and collisions

- Classification: backend tenant-isolation fix, found in V2a grounding.
- Explicit exclusions: save_marketing_content (migration, V2a), the growth draft functions (V2a).

## Review and limitations

Independent review: pending at the time of writing; recorded on the PR.
