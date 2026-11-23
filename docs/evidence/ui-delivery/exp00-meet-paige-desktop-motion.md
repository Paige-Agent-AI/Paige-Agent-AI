# Meet PAIGE desktop motion

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: follows the existing Talk live with Paige entry through intro, listening, playback, hold, resume, interrupt and End.
PAIGE_UI_DESIGN: PASS: uses the approved Conversation Film focal sequence and Impeccable Animate guidance for frame pacing, accessible fallbacks and motion that follows the conversation.
MATERIAL_FLOW_CHANGE: NO: the command intro and galaxy have the same role and duration. Session transitions and controls use their existing paths.
FLOW_PROTOTYPE: NOT_REQUIRED: this presentation tuning preserves the approved design and the choices, exits and effects of the existing Live flow.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: workspace owners can talk with Paige using the existing thread and Live controls.
VISUAL_DIRECTION: PASS: the original Command Logo and bottom waveform remain. Stars and gold orbits now rotate as two depth-projected layers. The galaxy retains its seeded artwork and placement.
AUTOMATED_EVIDENCE: PASS: 79 targeted Live component, output playback, relay and provider boundary tests.
STATIC_EVIDENCE: PASS: targeted ESLint, Git whitespace validation, Impeccable detector and production-mode Vite component fixture build.
RENDERED_EVIDENCE: PASS: Chrome desktop and phone captures, Edge desktop and phone renders, and Windows Playwright WebKit desktop and narrow renders. Independent Impeccable finish review cleared the local presentation.
BEHAVIORAL_EVIDENCE: PASS: the final retry passed nine browser fixtures covering natural or skippable intro, painted rotating layers, speaking-only captions, the lower waveform, Hold, Resume, Interrupt, End and reduced motion. Narrow WebKit and the 900-pixel Chrome viewport had zero horizontal overflow.
AUTHENTICATED_RUNTIME: UNVERIFIED: source is verified using isolated mock relay input. Production authentication, real speech and commercial signup are outside these performance measurements.
KEYBOARD_FOCUS: PASS: the user can focus and activate Skip intro with Enter at the tested Chrome and Edge sizes.
ZOOM_REFLOW: UNVERIFIED: responsive CSS geometry and multiple pixel densities were exercised. Actual browser zoom, text resize and a physical display switch remain unverified.
REDUCED_MOTION: PASS: large motion is bypassed and voice feedback stays visible at a measured lower cadence. Both layer animations respect the browser preference.
STATE_COVERAGE: PASS: intro, listening, active audio, hold, resume, interrupt, reduced motion and End exercised using synthetic playback. Source review inspected visibility, renderer resize and cleanup.
TRUTHFUL_STATE_LABELS: PASS: the waveform takes its amplitude from the existing playback input and captions follow playback.
SOLO_UI: YES: the shared signed-in Live Conversation and Meet PAIGE stage.
UNVERIFIED: native macOS Safari smoothness, physical-phone performance, browser zoom and authenticated provider audio.

INTERNAL_BUILD_IDENTITY: de78cd08988f5763fed193a6b0d65e075680676d; deployment=PROOF_OWED(PAIGE Cloud); environment=local; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp00-meet-paige-desktop-motion.md
RELEASE_CHANNEL: development: local renderer verification.
RELEASE_CLASSIFICATION: patch: presentation and performance tuning for the existing voice stage.
CUSTOMER_RELEASE_IDENTITY: none: this motion update has no separate customer version.
RELEASE_NOTE_REQUIRED: NO: the existing Live experience keeps its flow and controls.
RELEASE_TRUTH_BOUNDARY: PARTIAL: Chrome and Edge frame pacing improved in the local fixture. Apple Safari performance and hosted real voice remain unverified.
RELEASE_RECOVERY: position=restore the previously verified PAIGE Cloud web image if the Live stage regresses; reference=ANT-178 deployment and rollback readback.
SOLO_1536X770_PAIGE_CLOSED: PASS: local Chrome fixture opens and returns to the existing trigger after End.
SOLO_1536X770_PAIGE_OPEN: PASS: local Chrome scene and lower waveform are visible within the stage.
SOLO_1366X768_PAIGE_CLOSED: PASS: local Chrome fixture opens and returns to the existing trigger after End.
SOLO_1366X768_PAIGE_OPEN: PASS: local Chrome scene and lower waveform are visible within the stage.
SOLO_1024X768_PAIGE_CLOSED: PASS: local Chrome fixture opens and returns to the existing trigger after End.
SOLO_1024X768_PAIGE_OPEN: PASS: local Chrome scene and lower waveform fit without horizontal overflow.
SOLO_900X1000_PAIGE_CLOSED: PASS: local Chrome fixture opens and returns to the existing trigger after End.
SOLO_900X1000_PAIGE_OPEN: PASS: local Chrome scene and lower waveform fit without horizontal overflow.

## Measured rendering

The isolated fixture counted browser frame callbacks and actual canvas clears during 1.5 seconds of steady, simulated speaking. The original Chrome and Edge builds painted the galaxy and waveform about 45 times in each desktop run while the browser offered about 90 callbacks. The final build drew the waveform 89–90 times while the galaxy advanced without a canvas repaint. Chrome and Edge had comparable counts at 1440×900 at DPR 1 and 2 and 390×844 at DPR 3. Their desktop waveform p95 intervals were 17.1–18.6 ms. These measurements cover local browser work and emulated viewports. Display refresh and physical-phone performance remain unverified.

Windows Playwright WebKit passed the interaction matrix at its default pixel density. Performance varied across runs. The final desktop test measured 13 and 5 browser callbacks in individual 1.5-second runs at DPR 1 and 2. The nearby baseline rerun measured 20 and 3. A DPR 3 narrow run observed a stationary transform over one 240 ms interval. These results establish neither a consistent WebKit improvement nor Safari parity. The production promotion remains pending native Safari testing on macOS.

The procedural galaxy paints tightly bounded textures on first size and device-pixel-density changes. CSS transforms move the star field and orbit layers independently. The projected silhouette rotates with the layers. The scene clips the transformed square bounds to prevent horizontal stage scrolling. The waveform samples the existing playback amplitude on a time basis and interpolates between samples for foreground repaint cadence. Galaxy motion pauses on Hold or hidden documents and honors reduced motion. A Chromium emulated density change with a delivered resolution event exercised the refresh at a fixed CSS width. No physical display switch was exercised. No voice, authority, authentication, provider or billing paths change. See the [Second Brain lesson](../../brain/lessons-learned.md).
