# UI delivery evidence: exp07-platform-social-hub-surface

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: The Platform console Integrations surface gains the Social hub block: Find hub channels reads the provider readback through the paige-social door, adoptable channels render with checkboxes, and Confirm-this-Social-change runs the governed social_connection_adopt approval inline (Approve once / Decline). The door resolves the designated platform workspace server-side for the Platform Operator (God Level) caller.
PAIGE_UI_DESIGN: PASS: Implements the owner-approved Operator Social mockup's Guided-adoption variant on the Platform console design language (pack pg- tokens, raised plate, gold core CTA — the idioms of IntegrationsSurface itself); the brand-tile visual pass remains the following slice per owner sequencing.
MATERIAL_FLOW_CHANGE: YES: The Platform Operator account (God Level) gains the adoption capability ON ITS OWN CONSOLE — previously reachable only inside a Solo account's settings. With no active workspace session the door now operates on the ONE designated platform workspace via the platform-owner-only resolver, fail-closed.
FLOW_PROTOTYPE: UNVERIFIED: The interactive prototype is the owner-approved mockup (viz paige-operator-social-hub.html, Guided-adoption variant); the live console pass is the behavioral check owed.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: The Platform Operator (God Level account) adopts the platform hub's channels into the designated platform workspace; primary action = select channels then Approve once — the owner's build-on-the-Platform-Operator-account-first directive honored on its own surface.
VISUAL_DIRECTION: PASS: Existing Platform console tokens exclusively (var(--pg-*) palette, pack geometry idioms); no new CSS file, no hex, no literal radii — the surface reads as native to the Integrations grid.
AUTOMATED_EVIDENCE: PASS: Security-contract suite extended: resolver fallback + authority pinning on the door, the operator surface mount, the adoption actions, and the approval-card wiring; full verify suite on the exact head.
STATIC_EVIDENCE: PASS: Typecheck and lint run in the verify job on the exact head; source-contract tests read the door, the Integrations grid, and the new surface as text.
RENDERED_EVIDENCE: UNVERIFIED: No premerge console screenshot; the owner's walkthrough on the live Platform console is the rendered check, owed per the Nov-1 unrun-proof rule.
BEHAVIORAL_EVIDENCE: UNVERIFIED: The first governed adoption from the Platform console is the behavioral check owed; expected rows carry provided_by_platform=true in the designated workspace.
AUTHENTICATED_RUNTIME: UNVERIFIED: No authenticated adoption has run from the Platform console yet; the owner's first click after deploy is the runtime confirmation.
KEYBOARD_FOCUS: PASS: Native buttons and checkbox inputs only; document-order focus; no custom controls.
ZOOM_REFLOW: NOT_APPLICABLE: The block reflows with the console's existing flex layout; no fixed geometry.
REDUCED_MOTION: NOT_APPLICABLE: No motion introduced.
STATE_COVERAGE: PASS: Door unreachable, provider key invisible (capability_unavailable plain-language), empty readback, busy gating, approval card with Approve/Decline, adopted notice, and cancellation all rendered or pinned.
TRUTHFUL_STATE_LABELS: PASS: Only provider-readback-verified channels render; nothing adoptable is inferred; the platform workspace's adopted rows carry the platform-connection label in the Solo drawer.
SOLO_UI: NO: Platform console surface (src/operator seam) — the God Level account's Integrations grid, not a Solo interface. The Solo-side hub panel shipped separately in #3275.
UNVERIFIED: Production deploy (edge door + Vercel frontend on merge), the owner's first governed adoption from the Platform console, and a rendered console screenshot remain open; none are inferred as done.
INTERNAL_BUILD_IDENTITY: fddacdddffd0049377c961d9ba6e3b0ec119ba14; deployment=UNVERIFIED; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(paige-social redeploy owed — platform-owner workspace fallback); evidence=this record plus ANT-162 records 37636af7 and d0c3edd1
RELEASE_CHANNEL: development: Owner-directed Platform-Operator-account go-live ("go live on the Platform Operator account"); exact-head checks and authorized deploy remain required.
RELEASE_CLASSIFICATION: PATCH: New governed surface + fail-closed tenant fallback on the existing Social seam; additive only.
CUSTOMER_RELEASE_IDENTITY: none: Platform-console capability; customer visibility follows the owner's walkthrough and the Solo rollout slices.
RELEASE_NOTE_REQUIRED: no: Not advertised until the owner accepts the walkthrough.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: Source, tests, and CI complete — production deploy and the first live adoption from the Platform console have not run and are not inferred.
RELEASE_RECOVERY: position=revert the door fallback, the operator surface file, and the Integrations mount (a single revert removes the console surface and restores the session-tenant-only door with no schema change); reference=this record and the revert commit
