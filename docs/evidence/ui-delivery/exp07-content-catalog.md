# Solo Marketing Content catalog

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: A workspace owner browses Published or Media library, opens an original item and returns to the same place. Media previews retain the saved file and its existing download or playback actions.
PAIGE_UI_DESIGN: PASS: Applied the PAIGE UI delivery standard, Impeccable, Game UI/UX, Level Design and Animate to the owner-approved Content screen.
MATERIAL_FLOW_CHANGE: YES: Published records become the default starting point. Saved items remain a distinct library view.
FLOW_PROTOTYPE: PASS: Owner reviewed the interactive Content-only concept in ANT-162 and approved implementation in chat on Nov 22.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Eligible Solo workspaces can review what they published and find the original saved creative.
VISUAL_DIRECTION: PASS: The catalog leads with a featured item and a recent shelf. The detail reveal moves the selected artwork between views. The light or dark shell still uses Solo chrome.
AUTOMATED_EVIDENCE: PASS: 101 cases passed across Marketing Content, GrowthHub routing and the Social receipt model. Tests cover draft exclusion, original result links, focus return, tenant switching, rejection of a mismatched video list and existing saved-piece URLs.
STATIC_EVIDENCE: PASS: Content uses the existing tenant reads and server permissions. Video listing and playback now carry the selected tenant explicitly, and the library rejects mismatched video rows. Publication provenance is limited to the evidence held by the original record.
RENDERED_EVIDENCE: PASS: Chromium captured the actual ContentCatalog component with synthetic records at 1536×770, 1366×768, 1024×768, 900×1000 and 390×844. Desktop widths were checked both full and with a simulated 440 px dock. Artifacts are under outputs/exp07-content-catalog.
BEHAVIORAL_EVIDENCE: PASS: In the focused Chromium fixture, search, pointer and keyboard open and close, filter restoration, focus restoration and no horizontal overflow all passed at each tested width.
AUTHENTICATED_RUNTIME: UNVERIFIED: This source candidate has not been deployed or exercised with an ordinary eligible Solo session.
KEYBOARD_FOCUS: PASS: Enter focused the detail heading. Escape restored focus to the same tile and preserved search in Chromium.
ZOOM_REFLOW: UNVERIFIED: Focused Chromium had no overflow at the tested widths with and without a simulated dock. The authentic Solo shell and actual browser zoom still await verification.
REDUCED_MOTION: PASS: Chromium invoked a ready View Transition in both pointer directions at normal preference. At 390×844, reduced motion skipped the API and still opened and closed the detail.
STATE_COVERAGE: PASS: Published resolves loading, empty, retryable and filtered states. The existing saved library holds missing, malformed, loading, empty and permission states.
TRUTHFUL_STATE_LABELS: PASS: Actual publications appear from original source records. The catalog provides public result links where recorded. Analytics and authoring remain with Studio.
SOLO_UI: YES: The shared Marketing Content route serves eligible current and future Solo workspaces.
UNVERIFIED: Exact hosted readback, ordinary Solo acceptance and the EXP06 Studio original-asset receiver.

SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: Focused catalog fixture passed 1536X770 at full width. The full Solo shell and actual PAIGE panel at this size remain unverified.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: Focused catalog fixture passed 1536X770 with a simulated 440 px dock. The full Solo shell and actual PAIGE panel at this size remain unverified.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: Focused catalog fixture passed 1366X768 at full width. The full Solo shell and actual PAIGE panel at this size remain unverified.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: Focused catalog fixture passed 1366X768 with a simulated 440 px dock. The full Solo shell and actual PAIGE panel at this size remain unverified.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: Focused catalog fixture passed 1024X768 at full width. The full Solo shell and actual PAIGE panel at this size remain unverified.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: Focused catalog fixture passed 1024X768 with a simulated 440 px dock. The full Solo shell and actual PAIGE panel at this size remain unverified.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: Focused catalog fixture passed 900X1000 at full width. The full Solo shell and actual PAIGE panel at this size remain unverified.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: Focused catalog fixture passed 900X1000 with a simulated 440 px dock. The full Solo shell and actual PAIGE panel at this size remain unverified.

OWNER_INTENT: Redesign Content as the tenant's published work and media library. EXP06 owns creation in Vibe Studio for PAIGE and NEXUS.
MUST_PRESERVE: Saved piece IDs, authorized reads, original Social receipts, published URLs, saved-piece deep links, downloads, video playback and document previews.
ACCEPTANCE_CRITERIA: Open an actual recorded publication and return to the same catalog location using pointer or keyboard. Reopen a valid saved piece from its existing link. The paired Studio increment must separately prove that an eligible original asset opens in the correct Studio draft and that other types cannot enter that path.
MOTION_PURPOSE: Carry artwork from its tile into the detail view. Keep keyboard navigation and reduced motion immediate.
PROTECTED_SEAMS: Current tenant binding in the shared campaign, saved-library and Social reads. EXP06 retains Vibe Studio source and the creation engine.

INTERNAL_BUILD_IDENTITY: 351080a51cc11690f016617728816a736c0423d5; deployment=NOT_DEPLOYED; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=ANT-162
RELEASE_CHANNEL: development: Source candidate and local proof.
RELEASE_CLASSIFICATION: internal-only: Preparation of the owner-approved catalog change.
CUSTOMER_RELEASE_IDENTITY: none: Hosted application verification remains open.
RELEASE_NOTE_REQUIRED: no: This is an internal development increment.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: Ordinary Solo runtime and the paired Studio receiver.
RELEASE_RECOVERY: position=revert or correct the client change through the normal release path while retaining original tenant records; reference=ANT-162

## Scope and collisions

- The Content catalog uses current tenant published pages and active forms and funnels from the existing campaign read. Social entries use the existing saved publication receipt. The published list never reads provider history directly.
- Saved library previews and authorized file reads remain on the existing paths. Content no longer exposes its old creation, upload or publication control.
- Scope excludes Vibe Studio source, provider administration, provider writes, and schema changes. EXP06 owns the separate receiver required for the original media handoff. [Ownership and receiver](https://linear.app/paigeagentai/issue/ANT-162#comment-cb881769-5ea3-4118-a433-1f16c92e5ef5)

## User job and state map

Published → search or choose a type → open the original item → view its recorded link → return with focus, current filter and scroll. Media library → filter or follow a saved direct link → preview, play or download when available → close the preview. Marketing uses the existing campaigns scroll region.

## Review and limitations

The first independent review identified an implicit workspace video read and a source label stronger than the record supported. The revised source supplies the selected tenant to both video reads and limits source labels to evidence from the original record. The full Solo fixture did not finish loading in Chromium, so the browser evidence here is from the focused component fixture. EXP06 confirmed that the existing Studio launcher has no asset receiver. [Receiver confirmation](https://linear.app/paigeagentai/issue/ANT-162#comment-eaf93796-2ebd-48b5-998d-4d597492f5de)
