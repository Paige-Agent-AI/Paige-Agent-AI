# Content to Vibe Studio saved media

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Open a saved media detail in Content, check the original file in Studio, compose or return to the same detail. The state map below covers refusal and interruption.
PAIGE_UI_DESIGN: PASS: Extend the existing Studio palette, controls, modal and scroll owner. Reuse the governed post composer. Checked the existing screen, accessibility guidance, and Impeccable detector output.
MATERIAL_FLOW_CHANGE: YES: A saved file opens directly into the existing Studio social composer with its original record reference.
FLOW_PROTOTYPE: UNVERIFIED: No separate prototype was exercised. The real receiver components ran against synthetic responses in Vitest.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: An eligible Solo owner or admin can select an original saved image or video and prepare a social post in Studio.
VISUAL_DIRECTION: PASS: Follow the existing Studio ink world and typography. Keep the saved media next to the composer on wide screens and above it on narrow screens.
AUTOMATED_EVIDENCE: PASS: 220 tests across seven focused UI, shared shell, Social door, original media, and byte validation suites passed locally.
STATIC_EVIDENCE: PASS: Trace the shared launch shape into the protected Social read door and existing composer. The sender-controlled payload supplies no URL, revision, destination or permission.
RENDERED_EVIDENCE: UNVERIFIED: The receiver rendered in jsdom. Full browser geometry and composed Content and Studio evidence remain open.
BEHAVIORAL_EVIDENCE: UNVERIFIED: Component tests covered image and video, missing and foreign responses, decoder errors, and Escape ownership. The signed-in browser composition remains open.
AUTHENTICATED_RUNTIME: UNVERIFIED: Release the verified Edge and web sources, then open one original image and one original video from the composed Content tab with the ordinary Solo owner session.
KEYBOARD_FOCUS: UNVERIFIED: JSDOM verified focus enters at Back to Content and Escape is consumed by Studio. The composed browser still needs Tab order and return-focus readback.
ZOOM_REFLOW: UNVERIFIED: Verify stacked layout and reachability at browser zoom and the supported narrow widths after composition.
REDUCED_MOTION: UNVERIFIED: This path adds no motion. Verify the complete composed flow with the preference enabled.
STATE_COVERAGE: PASS: Local tests cover original PNG and MP4, unsupported file type, invalid bytes, stale revision, foreign and denied workspace, original preview refusal and return control.
TRUTHFUL_STATE_LABELS: PASS: A verified original opens a compose view. A refused or unreadable file returns an actionable message. Opening alone creates no approval, asset, post, receipt or schedule.
SOLO_UI: YES: Marketing Content to the existing Vibe Studio modal in the shared Solo shell.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: The receiver-only DOM harness has no browser viewport or Solo shell geometry.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: Verify the Studio modal and its return over the composed Content and Chat shell.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: Verify the original media and composer side by side in the composed browser.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: Verify the PAIGE-open chrome does not cover the Studio controls and return target.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: Verify both preview and composer are reachable in the Studio scroll owner.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: Verify focus and scroll ownership with the adjacent PAIGE panel open.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: Verify the Studio preview and composer fit in the narrower composed shell.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: Verify the narrower shell can still return to the original Content drawer with PAIGE open.
UNVERIFIED: Exact production Edge and web identity, signed-in original asset selection and return, and browser layout, focus and media playback.

OWNER_INTENT: Open the original saved image or video from Content in Vibe Studio to start a social post.
MUST_NOT_HAPPEN: Cross-workspace reads, trusting sender media metadata, generating or copying a file, or auto-creating an approval, post or schedule.
MUST_PRESERVE: Existing generic Studio launch, original saved file and Content selection, Studio focus return, original composer and governed later publication.
ACCEPTANCE_CRITERIA: In an eligible signed-in Solo workspace, open one real saved PNG or JPEG and one supported MP4. Check the same file in Studio, close with the button or Escape, and return to the same Content detail and action.
MOTION_PURPOSE: NONE: The receiver uses the current Studio modal and adds no animation.
PROTECTED_SEAMS: Active tenant and actor, protected source reader, Storage origin and byte identity, focus, exact revision, and unchanged approval and publication paths. No changes to authentication, billing, enrollment, or provider credentials.

INTERNAL_BUILD_IDENTITY: 175a13122140f4cdf7d1608c7a695ef6b11c925c; deployment=NOT_DEPLOYED; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(social-publish-command official source receipt); evidence=ANT-162 and the focused local Vitest command
RELEASE_CHANNEL: development: Scoped receiver candidate for the approved sender release.
RELEASE_CLASSIFICATION: internal-only: Bounded read-only ingress into the existing Studio post composer.
CUSTOMER_RELEASE_IDENTITY: none: Receiver and sender require integrated signed-in proof.
RELEASE_NOTE_REQUIRED: no: This is an internal delivery increment.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: Edge and app deploy, original image and video readback, browser focus return and composed Solo acceptance.
RELEASE_RECOVERY: position=Keep the sender disabled or roll back the affected verified web and Edge sources together. No native data migration.; reference=https://linear.app/paigeagentai/issue/ANT-162#comment-1cb9b57e-230a-4cbf-b5f0-6256fa06b0c5

## Scope and evidence

EXP06 owns the Studio receiver. EXP07 owns the Content sender and drawer on [#3381](https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/3381). The receiver uses the previously supported original `marketing_content` media family. Uploaded Stream-library playback, published provider-history media, and non-media files have their existing preview paths. Opening accepts no publish action. Later destination eligibility and approval remain in the existing Social workflow.

| State | Transition and recovery |
| --- | --- |
| Content detail | An enabled **Use in social post** button names the saved original and expected workspace. The Content detail stays mounted. |
| Checking | The existing Studio modal takes focus and the source screen is inert. Back or Escape returns to the initiating button. |
| Original verified | The same file is visible with the existing composer. On narrow viewports the Studio is the scroll owner. |
| Missing, changed, unsupported or unreadable file | The composer stays closed. The error points back to the original Content detail. |
| Workspace or actor change | The prior overlay is cleared without focusing an action from the old workspace. |

Local command `npx --no-install vitest run src/solo/studio/saved-media-handoff.render.test.tsx src/solo/vibe.render.test.tsx src/solo/studio/studio.render.test.tsx src/components/tenant-shell/TenantCommandCenterShell.ownership.test.tsx src/__tests__/social-publish-door.test.ts src/__tests__/social-publication-media.test.ts src/__tests__/social-publication-media-bytes.test.ts`.
