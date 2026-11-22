# Solo Content saved media opens in Vibe Studio

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: An eligible Solo owner opens a saved Content media preview, chooses Use in social post and returns to the same preview after closing Studio.
PAIGE_UI_DESIGN: PASS: Reviewed the existing Content and Studio direction using Impeccable and applied Game UI/UX guidance to the primary action, focus and reversible path.
MATERIAL_FLOW_CHANGE: YES: A saved Content preview can pass its original media reference into Studio for a private social draft.
FLOW_PROTOTYPE: PASS: The approved Content-only prototype in ANT-162 demonstrated this action and its Studio exit. Owner authorized implementation in the working chat.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: An eligible Solo owner can start a Studio social draft with the workspace's existing image or video.
VISUAL_DIRECTION: PASS: Keep the existing catalog and preview styling. Place Use in social post with the file actions. Studio owns the draft surface.
AUTOMATED_EVIDENCE: PASS: 104 targeted tests passed across Marketing Content, GrowthHub and the Social receipt model. Tests assert exact reference payloads for image and video, missing and mismatched original paths, wrong-source and pending-state exclusion, and keyboard ownership while the previous drawer is inert.
STATIC_EVIDENCE: PASS: The sender passes only the original Content row ID, media kind, expected tenant and return-focus element on the existing Studio launcher. Studio owns record access and byte validation.
RENDERED_EVIDENCE: UNVERIFIED: The sender rendered in component tests. The Studio receiver is being built separately and a combined browser capture has not run.
BEHAVIORAL_EVIDENCE: PASS: Component tests exercise the existing preview action, keep the drawer mounted and prove Escape reaches Content only after the background is active again. Combined receiver behavior requires runtime proof.
AUTHENTICATED_RUNTIME: UNVERIFIED: The paired release is required before testing the two original media types in the signed-in Academy session.
KEYBOARD_FOCUS: UNVERIFIED: Component tests verified drawer keyboard ownership and the returned focus reference. The actual Studio overlay round trip needs verification with the paired receiver.
ZOOM_REFLOW: UNVERIFIED: The action uses the existing wrapped action row. Combined browser rendering and zoom are outstanding.
REDUCED_MOTION: UNVERIFIED: The sender adds zero motion. Combined overlay behavior needs a runtime check.
STATE_COVERAGE: PASS: Sender tests cover a viable saved image, a viable saved video, an external file, a different workspace's file, a processing video and a document.
TRUTHFUL_STATE_LABELS: PASS: The button appears for eligible original-library candidates. Studio determines final compatibility before showing the attachment.
SOLO_UI: YES: The shared Solo Marketing Content route uses the existing Studio launcher in each eligible account.
UNVERIFIED: Original image and video in the deployed Studio draft, closing and reopening, and owner acceptance.

SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: The paired Studio receiver is required for the full shell path at this size.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: The paired Studio receiver is required for the full shell path with the PAIGE panel at this size.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: The paired Studio receiver is required for the full shell path at this size.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: The paired Studio receiver is required for the full shell path with the PAIGE panel at this size.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: The paired Studio receiver is required for the full shell path at this size.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: The paired Studio receiver is required for the full shell path with the PAIGE panel at this size.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: The paired Studio receiver is required for the full shell path at this size.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: The paired Studio receiver is required for the full shell path with the PAIGE panel at this size.

OWNER_INTENT: Open compatible saved Content images and videos in Vibe Studio. EXP06 owns creation.
MUST_PRESERVE: Original records, same-workspace authority, loaded preview and focus return, and existing Studio entry points.
ACCEPTANCE_CRITERIA: A signed-in eligible owner opens one existing image and one existing video in Studio with the correct original asset, then returns to the same preview. Unsupported sources and workspace mismatches are refused.
MOTION_PURPOSE: Keep the existing overlay and catalog transitions.
PROTECTED_SEAMS: The active tenant and existing global Studio opener remain authoritative. The preview's keyboard listener yields while its parent is inert.

INTERNAL_BUILD_IDENTITY: 49d5ad0c857b617e599b4f4a64392308522f87e8; deployment=NOT_DEPLOYED; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=ANT-162
RELEASE_CHANNEL: development: Local source and targeted component proof.
RELEASE_CLASSIFICATION: internal-only: Sender increment of the owner-approved Content outcome.
CUSTOMER_RELEASE_IDENTITY: none: The paired release and authenticated outcome are open.
RELEASE_NOTE_REQUIRED: no: Sender implementation is an internal increment pending paired proof.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: Paired deployment, original-media runtime and authenticated Solo round trip.
RELEASE_RECOVERY: position=retain and reopen the original asset in Content through the existing preview; reference=ANT-162

## Scope and collisions

- EXP07 owns the Content action and the local drawer guard. EXP06 owns Studio, the authoritative eligibility read and its release. [Agreed receiver contract](https://linear.app/paigeagentai/issue/ANT-162#comment-4e7c43a0-c5ca-4b6f-abe9-90daeea7b80c)
- Saved marketing-library images and videos with an original workspace storage object qualify for the handoff. Stream playback records, external URLs and non-media remain available in their existing previews.
- The Content action opens Studio with the original reference. Publishing approvals and provider operations remain in their existing authority paths.
