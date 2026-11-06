# UI delivery evidence: exp07-messaging-publish-targets

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: EXP07's create-and-publish loop closed on the channels the owner actually connected. The piece-publish flow already shipped end to end (Growth → Content → a piece → "Publish to a channel": per-network REAL readiness from the same governed presence read, editable words prefilled from the piece, the door's own preview, one governed approval, and outcomes stated exactly — Published with the link, Partially published, Failed with nothing posted, or Outcome being checked with reconcile-before-retry). What was missing: its picker offered six networks and its gates admitted the social ten only, so the Discord and Telegram channels the platform and Solo accounts connected on 2026-11-06 could not receive a post. This slice widens publishing to the provider's documented messaging targets at all three gates: the seam's SOCIAL_POST_PLATFORMS (social ∪ discord ∪ telegram; google deliberately absent — Gmail/Calendar are connections, not post targets), the adapter's postPlatform validator, and the publish door's PLATFORMS set; the picker's SOCIAL_NETWORKS gains Discord and Telegram with readiness still derived from the presence read alone — an unconnected channel says Not connected, never probably fine.
PAIGE_UI_DESIGN: PASS: No new surface — the existing publish picker and drawer render two more rows in the page's own language; the only new copy is two network labels and hints in the established ladder.
MATERIAL_FLOW_CHANGE: YES: A connected Discord server or Telegram channel becomes a real publish destination for saved pieces, behind the same governed approval — the moment the connections become usable for content work (the owner's stated goal).
FLOW_PROTOTYPE: UNVERIFIED: No prototype; this widens the owner's live publish flow at its validation gates.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: A Solo business owner publishes a saved piece to their Discord server or Telegram channel; primary action = piece → Publish to a channel → pick the connected channel → approve once.
VISUAL_DIRECTION: PASS: Existing Solo design language exclusively; no new tokens or components.
AUTOMATED_EVIDENCE: PASS: Security contract pins all three widened gates (the seam's POST set with discord+telegram, the adapter validator, the door's PLATFORMS carrying the same two and never google); independent NON-AUTHOR review pass run before push.
STATIC_EVIDENCE: PASS: Typecheck and lint run in the verify job on the exact head.
RENDERED_EVIDENCE: UNVERIFIED: No premerge render; the owner's walkthrough on the live publish flow is the rendered check, owed per the Nov-1 unrun-proof rule.
BEHAVIORAL_EVIDENCE: UNVERIFIED: One governed publish from a saved piece to a connected Discord or Telegram channel is the behavioral check owed — the owner's click; every layer beneath it (the door, the posting arm, the honest outcome mapping) is already live-proven for social posts.
AUTHENTICATED_RUNTIME: UNVERIFIED: No authenticated publish pass has run on this increment yet.
KEYBOARD_FOCUS: PASS: No new controls; the existing picker and approval flow.
ZOOM_REFLOW: NOT_APPLICABLE: Two more rows in the existing reflowing list.
REDUCED_MOTION: NOT_APPLICABLE: No motion added.
STATE_COVERAGE: PASS: The two new picker rows carry every existing honest readiness state (Connected / Needs you to sign in again / Not connected) from the presence read — genuinely reachable now that the presence constant widens with the ladder (migration 20271133000007); publish outcomes unchanged and honest.
TRUTHFUL_STATE_LABELS: PASS: Readiness from the lifecycle read alone; outcomes verbatim from the door; google never offered as a post target.
SOLO_UI: YES: src/solo/social-truth.ts is a recognized Solo UI path (the shared network ladder the publish picker renders); the change widens that ladder by two entries in its own format.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: No premerge harness render this slice; the owner's walkthrough on the live publish flow is the rendered check owed.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: Same reason as the closed frame — the owner's live walkthrough is the rendered check owed.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: Same reason as the closed frame — the owner's live walkthrough is the rendered check owed.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: Same reason as the closed frame — the owner's live walkthrough is the rendered check owed.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: Same reason as the closed frame — the owner's live walkthrough is the rendered check owed.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: Same reason as the closed frame — the owner's live walkthrough is the rendered check owed.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: Same reason as the closed frame — the owner's live walkthrough is the rendered check owed.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: Same reason as the closed frame — the owner's live walkthrough is the rendered check owed.
UNVERIFIED: Production deploy (Vercel frontend plus the two redeployed shared edges), the owner's walkthrough, and one governed publish to Discord or Telegram remain open; none are inferred as done.
INTERNAL_BUILD_IDENTITY: 849f69097ad8db2cb1e57084d48950f92dc7593b; deployment=UNVERIFIED; environment=development; migrations=APPLIED(20271133000007_publish_network_ladder_widened); the two SECURITY DEFINER network constants (record_social_handles._allowed, get_social_presence_evidence.v_networks) widen with the ladder — without them the handle save fails whole and the presence read drops the connected rows (review blockers); apply owed via the deploy pipeline; edge=PROOF_OWED(social-publish-command door and the provider seam must redeploy with the widened gates); evidence=this record plus record exp07-solo-connection-parity
RELEASE_CHANNEL: development: Owner-GO'd EXP07 increment; exact-head checks and authorized deploy remain required.
RELEASE_CLASSIFICATION: PATCH: Two publish targets added at three validation gates plus two picker rows; additive only.
CUSTOMER_RELEASE_IDENTITY: none: Not advertised until the owner accepts the walkthrough.
RELEASE_NOTE_REQUIRED: no: Not advertised until the owner accepts the walkthrough.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: Source, tests, and CI complete on this head — production deploy, the edge redeploys, and the owner's live walkthrough have not run and are not inferred.
RELEASE_RECOVERY: position=revert this commit to restore social-only publishing at all three gates and the six-network picker; reference=this record and the revert commit
