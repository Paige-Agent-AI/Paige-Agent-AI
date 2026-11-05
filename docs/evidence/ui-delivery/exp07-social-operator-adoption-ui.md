# UI delivery evidence: exp07-social-operator-adoption-ui

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: SocialHubPanel on Settings -> Integrations (admin-only) lists the platform hub's provider-verified channels, adopts the chosen ones through ONE governed social_connection_adopt approval rendered inline (Approve once / Decline), and every platform-provided identity is labeled in the Social drawer ("· platform connection"). Hook: useSocialConnections gains hubProfiles()/adopt() riding the same invoke approval machinery as every other Social mutation, plus providedByPlatform passthrough.
PAIGE_UI_DESIGN: PASS: Implements the owner-approved Operator Social mockup (viz paige-operator-social-hub.html "Guided adoption" variant: found-channels list, checkboxes, Confirm-this-Social-change CTA, honest not-adoptable handling) using the existing Integrations design tokens and component classes; the full brand-tile visual pass is the following slice per the owner's sequencing.
MATERIAL_FLOW_CHANGE: YES: Workspace admins gain the adoption action on the Integrations surface — one governed approval imports the platform hub's channels as labeled platform connections; the approval card for adoption renders on the page surface, not only inside a platform drawer.
FLOW_PROTOTYPE: UNVERIFIED: The interactive prototype is the owner-approved mockup (viz paige-operator-social-hub.html, Guided-adoption variant); the live browser pass on production is the behavioral check recorded below.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: The platform operator (workspace admin) adopts their hub's already-connected channels into the workspace; primary action = select channels then Approve once, matching the owner's operator-first directive.
VISUAL_DIRECTION: PASS: Existing Integrations/Social tokens and classes (ig-btn, ig-state, social-ig-*) exclusively — no new CSS, so no style drift; motion and brand tiles follow in the next slice.
AUTOMATED_EVIDENCE: PASS: Security-contract suite extended: adoption actions present in the hook, the governed capability wired through invoke, the inline approval card (Approve once / Decline) pinned, the hub panel mounted in the catalogue, platform-connection labeling pinned, plus the full verify suite on the exact head.
STATIC_EVIDENCE: PASS: Typecheck and lint run in the verify job on the exact head; source-contract tests read the hook, drawer, and catalogue directly.
RENDERED_EVIDENCE: UNVERIFIED: No premerge browser screenshot was taken; the owner's guided walkthrough on production is the rendered check, recorded as owed per the Nov-1 browser-proof rule (unrun live proof never blocks an otherwise-green merge).
BEHAVIORAL_EVIDENCE: UNVERIFIED: The first governed adoption on production (owner click) is the behavioral check owed; expected path is approval card -> adopted rows with provided_by_platform=true.
AUTHENTICATED_RUNTIME: UNVERIFIED: No authenticated adoption has run against production yet; the operator's first click after deploy is the runtime confirmation.
KEYBOARD_FOCUS: PASS: Native checkbox inputs and buttons only; focus order follows document order inside the panel; no custom controls were introduced.
ZOOM_REFLOW: NOT_APPLICABLE: No fixed geometry; the panel reflows with the existing Integrations layout.
REDUCED_MOTION: NOT_APPLICABLE: No motion added in this slice.
STATE_COVERAGE: PASS: Hub read failure (role=alert + retry via Check again), empty readback ("No adoptable hub channels"), busy gating on every action, approval card with Approve/Decline, and the post-adopt notice are all rendered states pinned or present.
TRUTHFUL_STATE_LABELS: PASS: Only provider-readback-verified channels are offered; non-adoptable hub channels are never shown as available; adopted rows carry the platform-connection label in the drawer.
SOLO_UI: NO: Settings -> Integrations surface (workspace settings), not the Solo shell.
UNVERIFIED: Production deploy of the frontend (Vercel on merge), the owner's first governed adoption, and a rendered screenshot pass remain open; nothing here is inferred as done.
INTERNAL_BUILD_IDENTITY: 388132b295112fb9eb57b1cb1898d9520e725c54; deployment=UNVERIFIED; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=this record plus ANT-162 records 564343f2 and 64e46939
RELEASE_CHANNEL: development: Owner-green-lit final slice of the evening ("let's make this live"); exact-head checks and authorized release remain required.
RELEASE_CLASSIFICATION: PATCH: New governed surface on the existing Social seam; additive only, no removals.
CUSTOMER_RELEASE_IDENTITY: none: Operator-facing capability; the customer-visible experience follows the owner's walkthrough.
RELEASE_NOTE_REQUIRED: no: Not advertised until the owner accepts the walkthrough.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: Source, tests, and CI are complete — production deploy and the first live adoption have not run and are not inferred.
RELEASE_RECOVERY: position=revert the four frontend files to their prior state (a single revert removes the panel and restores the prior hook with no schema or provider change); reference=this record and the revert commit
