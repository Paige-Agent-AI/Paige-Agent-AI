# UI delivery evidence: exp07-social-platform-connections

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Operator hub listing (hub_profiles) + governed adoption (social_connection_adopt) in paige-social, provider-readback-verified writes via the new social_adopt_platform_channels RPC, per-workspace platform-channel grants table (service-role-only), status projection gains provided_by_platform, disconnect of platform-provided connections stays local to the workspace.
PAIGE_UI_DESIGN: PASS: Backend slice of the owner-approved Operator Social design (viz mockup paige-operator-social-hub.html, owner approval Nov 4 incl. brand/color/motion + font pass); no customer-facing file changes in this slice — the surface ships in the following UI slice.
MATERIAL_FLOW_CHANGE: YES: New operator capability — a workspace admin can bring the platform hub's already-connected channels into the workspace as labeled platform-provided connections through one governed approval; disconnect semantics for those rows change (local-only, shared provider profile never revoked).
FLOW_PROTOTYPE: UNVERIFIED: The adoption flow's browser prototype arrives with the following UI slice; this slice's behavior is pinned source-level by the security-contract tests (governed-before-write, readback-verified-only, hub-key tenant-namespacing, grants empty-by-default).
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Platform operators adopting their hub channels into a workspace; primary action = approve-once adoption, matching the owner's operator-first directive (ANT-162 Nov 4 records).
VISUAL_DIRECTION: PASS: No visual files changed; the approved design tokens and mockup govern the following UI slice.
AUTOMATED_EVIDENCE: PASS: Extended social-connection-security-contract.test.ts pins adoption governance order, SOCIAL_ADOPT_* refusal codes, migration constraints, hub-helper tenant-profile exclusion, disconnect guard, and grants RLS; full verify suite on this PR's exact head.
STATIC_EVIDENCE: PASS: Source-contract tests read the deployed door, adapter, and migration as text; typecheck and lint run in the verify job.
RENDERED_EVIDENCE: NOT_APPLICABLE: No UI file changes in this slice.
BEHAVIORAL_EVIDENCE: UNVERIFIED: First governed adoption (operator click through the UI slice, or a direct governed adopt call) is the live proof; expected a paige_social_connections row with provided_by_platform=true and verified accounts.
AUTHENTICATED_RUNTIME: UNVERIFIED: No adoption has run against production yet — the operator's first governed adoption after deploy-migrations and the door redeploy is the runtime confirmation, visible as a provided_by_platform=true connection row plus edge-log receipts.
KEYBOARD_FOCUS: NOT_APPLICABLE: No controls changed in this slice.
ZOOM_REFLOW: NOT_APPLICABLE: No layout changed.
REDUCED_MOTION: NOT_APPLICABLE: No motion changed.
STATE_COVERAGE: PASS: Adoption paths pinned: unconfigured provider (503 capability_unavailable), non-admin listing (403 SOCIAL_HUB_FORBIDDEN), approval-invalid (409), nothing-verified-in-readback (409 SOCIAL_ADOPT_NOTHING_VERIFIED), RPC failure (500 SOCIAL_ADOPT_FAILED), and idempotent re-adoption via hub-key upsert.
TRUTHFUL_STATE_LABELS: PASS: provided_by_platform=false is the untouched default for every tenant-consented connection; adoption labels every row it writes; skipped platforms are returned to the caller instead of silently connected.
SOLO_UI: NO: Edge + migration slice behind the existing governed door; no Solo shell file changed.
UNVERIFIED: Migration application (deploy-migrations), function redeploy, and the first live governed adoption remain open; no adoption has run against production yet.
INTERNAL_BUILD_IDENTITY: 0540eb599da2ab8999c565ca6597770be6245eaa; deployment=UNVERIFIED; environment=development; migrations=PROOF_OWED(20271131000001_social_platform_connections via deploy-migrations); edge=PROOF_OWED(paige-social redeploy owed); evidence=this record plus ANT-162 records 64e46939 and a08b53fd
RELEASE_CHANNEL: development: Owner-green-lit slice of the approved Operator Social design; exact-head checks and authorized deploy remain required.
RELEASE_CLASSIFICATION: PATCH: New governed capability on the existing Social seam; no removal, no rebranding, no schema break (additive column + new table + new RPC).
CUSTOMER_RELEASE_IDENTITY: none: Internal capability slice; the customer-visible experience lands with the UI slice and owner acceptance.
RELEASE_NOTE_REQUIRED: no: Not yet advertised; the Operator experience notice follows the UI slice.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: Source, tests, and migration are written and CI-verified; production migration application, redeploy, and first adoption are not yet proven and are not inferred.
RELEASE_RECOVERY: position=revert the migration file and door changes (additive column and grants table stay inert if left applied since no writer exists without the door actions — a single revert restores prior behavior with no data change required); reference=this record and the revert commit
